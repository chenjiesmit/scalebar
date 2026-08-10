#!/usr/bin/env python3
"""
oir_to_tif_scalebar.py
Olympus FV3000 .oir  ->  16-bit per-channel TIFF (with real pixel-size metadata)
                     ->  RGB composite TIFF with a burned-in scale bar

No Java / no Bio-Formats needed: the .oir container is parsed directly.
Tested on FV3000 v2.6.x single-plane multi-channel files.

Usage
-----
  python oir_to_tif_scalebar.py IMAGE.oir [options]

  --outdir DIR        output folder (default: alongside input)
  --bar 50            scale-bar length in micrometres (default: auto)
  --pos br            bar position: br, bl, tr, tl (default: br)
  --color white       bar/label colour (white | black | yellow)
  --no-label          draw the bar without the "50 µm" text
  --lo 0.10 --hi 99.9 display percentiles used for the 8-bit composite
  --colors B,G,R      one colour letter per channel for the composite
                      (R G B C M Y W  or  '-' to skip a channel)
"""
import argparse, json, math, os, re, struct, sys
import numpy as np
import tifffile
from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
LUTS = {"R": (1, 0, 0), "G": (0, 1, 0), "B": (0, 0, 1),
        "C": (0, 1, 1), "M": (1, 0, 1), "Y": (1, 1, 0), "W": (1, 1, 1)}


# ---------------------------------------------------------------- OIR parsing
def parse_oir(path):
    d = open(path, "rb").read()
    if d[:16] != b"OLYMPUSRAWFORMAT":
        raise ValueError("not an Olympus .oir file")
    n = len(d)
    u32 = lambda p: struct.unpack_from("<i", d, p)[0]

    # --- pixel data blocks: [len][3][8 bytes][uidlen][uid][nbytes][4 bytes][data]
    blocks, p = [], 0
    while p + 40 < n:
        if u32(p + 4) == 3 and 12 < u32(p) < 300:
            uidlen = u32(p + 16)
            if u32(p) == uidlen + 12 and 0 < uidlen < 250:
                uid = d[p + 20:p + 20 + uidlen]
                if all(32 <= c < 127 for c in uid):
                    nb = u32(p + 20 + uidlen)
                    if 0 < nb <= n - p:
                        blocks.append((uid.decode(), nb, p + 28 + uidlen))
                        p += 28 + uidlen + nb
                        continue
        p += 1

    # --- XML: image properties + per-channel dye names
    xml_ranges = [m.start() for m in re.finditer(rb"<\?xml", d)]
    props, chan_xml = None, {}
    for i in xml_ranges:
        seg = d[i:i + 300000]
        z = seg.find(b"\x00")
        if z > 0:
            seg = seg[:z]
        s = seg.decode("ascii", "replace")
        if "lsmimage:imageProperties" in s[:200] and props is None:
            props = s
        elif "lsmimage:lsmChannel" in s[:200]:
            cid = re.search(r'id="([0-9a-f-]{36})"', s)
            if cid:
                chan_xml[cid.group(1)] = s
    if props is None:
        raise ValueError("no imageProperties XML found")

    g = lambda pat, s=props: (re.search(pat, s, re.S).group(1) if re.search(pat, s, re.S) else None)
    W = int(g(r"<commonimage:width>(\d+)<"))
    H = int(g(r"<commonimage:height>(\d+)<"))
    px = float(re.search(r"<commonphase:length>\s*<commonparam:x>([\d.eE+-]+)<", props).group(1))
    unit = g(r"<commonphase:x>(\w+)</commonphase:x>") or "MICRO_METER"

    meta = dict(width=W, height=H, pixel_size_um=px, pixel_unit=unit,
                system=g(r"<base:systemName>(.*?)<"),
                sw=g(r"<base:systemVersion>(.*?)<"),
                scope=g(r"<base:name>(.*?)<"),
                date=g(r"<base:creationDateTime>(.*?)<"),
                objective=g(r"<commonimage:objectiveLens[^>]*>\s*<opticalelement:name>(.*?)<"),
                na=g(r"<commonimage:objectiveLens.*?<opticalelement:naValue>([\d.]+)<"),
                immersion=g(r"<commonimage:objectiveLens.*?<opticalelement:immersion>(\w+)<"),
                zoom=g(r"<lsmparam:zoom>([\d.]+)<"),
                bits=g(r"<commonphase:bitCounts>(\d+)<"))

    # --- channel order from imageProperties
    order = []
    for m in re.finditer(r'<commonphase:channel id="([0-9a-f-]{36})" order="(\d+)">'
                         r'.*?<commonphase:name>(CH\d+)</commonphase:name>', props, re.S):
        cid, o, name = m.group(1), int(m.group(2)), m.group(3)
        dye = None
        if cid in chan_xml:
            dm = re.search(r"<dye:name>(.*?)<", chan_xml[cid])
            dye = dm.group(1) if dm else None
        order.append(dict(id=cid, order=o, name=name, dye=dye))
    order.sort(key=lambda c: c["order"])

    # --- assemble planes (ignore REF_LSM preview blocks)
    real = [b for b in blocks if not b[0].startswith("REF_LSM")]
    planes = {}
    for uid, nb, off in real:
        m = re.match(r"(.+?)_([0-9a-f-]{36})_(\d+)$", uid)
        if not m:
            continue
        planes.setdefault((m.group(1), m.group(2)), {})[int(m.group(3))] = (off, nb)

    prefixes = sorted({k[0] for k in planes})
    stacks = []
    for pref in prefixes:
        chans = []
        for c in order:
            parts = planes.get((pref, c["id"]))
            if parts is None:
                chans.append(np.zeros((H, W), np.uint16)); continue
            buf = b"".join(d[o:o + l] for o, l in (parts[i] for i in sorted(parts)))
            a = np.frombuffer(buf, "<u2")
            if a.size != W * H:
                a = np.resize(a, W * H)
            chans.append(a.reshape(H, W))
        stacks.append(np.stack(chans))
    return np.stack(stacks), order, meta      # (planes, C, Y, X)


# ---------------------------------------------------------------- scale bar
def nice_bar(field_um):
    """round scale bar closest to ~20 % of the field width (log distance)"""
    target = field_um * 0.2
    opts = (0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000)
    return min(opts, key=lambda v: abs(math.log(v / target)))


def draw_scalebar(img, px_um, bar_um, pos="br", color="white", label=True):
    """img: PIL RGB image. Burns in bar + label, returns the image."""
    W, H = img.size
    bar_px = bar_um / px_um
    th = max(3, round(H * 0.012))              # bar thickness
    m = round(min(W, H) * 0.045)               # margin
    fs = max(12, round(H * 0.052))             # font size
    font = ImageFont.truetype(FONT, fs)
    fg = {"white": (255, 255, 255), "black": (0, 0, 0),
          "yellow": (255, 241, 0)}[color]
    dr = ImageDraw.Draw(img)

    x1 = W - m if pos.endswith("r") else m + bar_px
    x0 = x1 - bar_px
    if pos.startswith("b"):
        y1 = H - m
    else:
        y1 = m + th + (fs * 1.15 if label else 0)
    dr.rectangle([x0, y1 - th, x1, y1], fill=fg)

    if label:
        txt = f"{bar_um:g} \u00b5m"
        tb = dr.textbbox((0, 0), txt, font=font)
        tw, tht = tb[2] - tb[0], tb[3] - tb[1]
        tx = (x0 + x1) / 2 - tw / 2
        ty = y1 - th - tht * 1.55 if pos.startswith("b") else y1 - th - tht * 1.55
        dr.text((tx - tb[0], ty - tb[1]), txt, font=font, fill=fg)
    return img


def stretch(a, lo, hi):
    a = a.astype(np.float32)
    l, h = np.percentile(a, lo), np.percentile(a, hi)
    if h <= l:
        h = l + 1
    return np.clip((a - l) / (h - l), 0, 1), float(l), float(h)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("oir")
    ap.add_argument("--outdir", default=None)
    ap.add_argument("--bar", type=float, default=None)
    ap.add_argument("--pos", default="br", choices=["br", "bl", "tr", "tl"])
    ap.add_argument("--color", default="white", choices=["white", "black", "yellow"])
    ap.add_argument("--no-label", action="store_true")
    ap.add_argument("--lo", type=float, default=0.10)
    ap.add_argument("--hi", type=float, default=99.9)
    ap.add_argument("--colors", default=None)
    a = ap.parse_args()

    stack, chans, meta = parse_oir(a.oir)
    base = os.path.splitext(os.path.basename(a.oir))[0]
    out = a.outdir or os.path.dirname(os.path.abspath(a.oir))
    os.makedirs(out, exist_ok=True)
    px = meta["pixel_size_um"]
    nZ, nC, H, W = stack.shape
    bar = a.bar or nice_bar(W * px)

    print(f"{base}: {W}x{H} px, {nC} ch, {nZ} plane(s), "
          f"{px:.6f} um/px  ->  field {W*px:.1f} x {H*px:.1f} um")
    print(f"objective {meta['objective']} NA {meta['na']} ({meta['immersion']}), "
          f"zoom {meta['zoom']}, {meta['bits']}-bit, {meta['date']}")

    # default composite LUTs from the dye names
    if a.colors:
        cols = [c.strip().upper() for c in a.colors.split(",")]
    else:
        cols = []
        for c in chans:
            dye = (c["dye"] or "").lower()
            cols.append("B" if "dapi" in dye or "hoech" in dye else
                        "G" if "488" in dye or "gfp" in dye or "fitc" in dye else
                        "R" if any(k in dye for k in ("555", "568", "594", "546", "tritc", "cy3")) else
                        "M" if any(k in dye for k in ("647", "cy5", "633")) else "W")
    cols += ["-"] * (nC - len(cols))

    report = [f"source file        : {os.path.basename(a.oir)}",
              f"instrument         : {meta['system']} / {meta['scope']} (SW {meta['sw']})",
              f"acquired           : {meta['date']}",
              f"objective          : {meta['objective']}, NA {meta['na']}, {meta['immersion']}, zoom {meta['zoom']}",
              f"image size         : {W} x {H} px, {nC} channels, {nZ} plane(s), {meta['bits']}-bit",
              f"pixel size         : {px:.6f} um/px  ({meta['pixel_unit']})",
              f"field of view      : {W*px:.2f} x {H*px:.2f} um",
              f"scale bar drawn    : {bar:g} um = {bar/px:.1f} px", ""]

    written = []
    for z in range(nZ):
        tag = "" if nZ == 1 else f"_z{z+1:03d}"
        rgb = np.zeros((H, W, 3), np.float32)
        for i, c in enumerate(chans):
            img = stack[z, i]
            empty = img.max() == 0
            fn = os.path.join(out, f"{base}{tag}_{c['name']}_{(c['dye'] or 'ch').replace(' ','')}.tif")
            # 16-bit raw channel, real calibration (ImageJ reads this as um)
            tifffile.imwrite(fn, img, photometric="minisblack",
                             resolution=(1 / px, 1 / px),
                             metadata={"unit": "um", "axes": "YX"},
                             resolutionunit="NONE", imagej=True)
            written.append(fn)
            line = (f"{c['name']:4s} {c['dye'] or '-':16s} LUT {cols[i]:1s}  "
                    f"min {img.min():5d} max {img.max():5d} mean {img.mean():7.1f}"
                    + ("   [EMPTY - no signal]" if empty else ""))
            if not empty:
                norm, lo_v, hi_v = stretch(img, a.lo, a.hi)
                line += f"   display {lo_v:.0f}-{hi_v:.0f}"
                if cols[i] in LUTS:
                    r, g, b = LUTS[cols[i]]
                    rgb[..., 0] = np.maximum(rgb[..., 0], norm * r)
                    rgb[..., 1] = np.maximum(rgb[..., 1], norm * g)
                    rgb[..., 2] = np.maximum(rgb[..., 2], norm * b)
                # per-channel 8-bit with bar
                gimg = Image.fromarray((norm * 255).astype(np.uint8)).convert("RGB")
                gimg = draw_scalebar(gimg, px, bar, a.pos, a.color, not a.no_label)
                fn2 = os.path.join(out, f"{base}{tag}_{c['name']}_scalebar.tif")
                tifffile.imwrite(fn2, np.array(gimg), photometric="rgb",
                                 resolution=(1 / px, 1 / px),
                                 metadata={"unit": "um"}, resolutionunit="NONE")
                written.append(fn2)
            report.append(line)

        comp = Image.fromarray((rgb * 255).astype(np.uint8))
        comp = draw_scalebar(comp, px, bar, a.pos, a.color, not a.no_label)
        fnc = os.path.join(out, f"{base}{tag}_composite_scalebar.tif")
        tifffile.imwrite(fnc, np.array(comp), photometric="rgb",
                         resolution=(1 / px, 1 / px),
                         metadata={"unit": "um"}, resolutionunit="NONE")
        written.insert(0, fnc)
        Image.fromarray(np.array(comp)).save(fnc[:-4] + ".png")

    rp = os.path.join(out, f"{base}_metadata.txt")
    open(rp, "w").write("\n".join(report) + "\n")
    written.append(rp)
    print("\n".join(report))
    print("\nwrote:")
    for f in written:
        print("  " + f)


if __name__ == "__main__":
    main()
