# Scale Bar

Drop an Olympus FluoView `.oir` in a browser tab and get a TIFF with a scale bar
of exactly the right length burned in. The bar comes from the µm-per-pixel the
scanner recorded, so it is correct by construction — no eyeballing, no **Set
Scale**, no Fiji.

Everything runs in the tab. The file is read locally and never uploaded.

---

## Use it

**Locally** — double-click `index.html`. That is the whole install.

**Share it with the lab** — send them `index.html`, or publish it:

1. Push this folder to a GitHub repo.
2. Repo → **Settings** → **Pages** → Source: `main`, folder: `/ (root)`.
3. It appears at `https://<you>.github.io/<repo>/` — GitHub serves `index.html`
   automatically.

Chrome is the best target. See [Browser support](#browser-support).

---

## What it reads

The `.oir` container is parsed directly — no Bio-Formats, no Java. From it the
tool takes:

- `commonphase:length` → **µm per pixel**, the number the scale bar depends on
- objective, NA, immersion, zoom, instrument, acquisition time
- the dye recorded per channel, used as the default colour and as the name
  placeholder
- the raw 12/16-bit planes

Tested against FluoView 2.6 files from an FV3000. Single-file `.oir` only.

**Not handled yet:** multi-file `.oir` sets (the `name_00001` companion files),
stitched mosaics, lambda stacks.

---

## What it exports

| Export | Format | Lossless? |
|---|---|---|
| Composite TIFF + bar | 8-bit RGB, uncompressed | pixels are a display product: 12/16-bit mapped to 8-bit through your LUTs |
| Composite PNG + bar | 8-bit RGB | same, PNG compression itself is lossless |
| Channels, greyscale + bar | 8-bit RGB, uncompressed | one file per shown channel |
| **Raw 16-bit channels** | 16-bit greyscale, uncompressed | **yes — the original pixel values**, µm calibration in the header, no bar |
| Acquisition metadata | `.txt` | for a methods section |

**Upscaling does not add information.** The pixel-scale control (1× / 2× / 4×)
replicates pixels nearest-neighbour at integer factors, which is exactly
reversible by decimation. It buys a print-resolution bar and label; it invents
no detail. The default picks the smallest factor that puts the long edge over
1500 px, so a 512² acquisition exports at 2048² and a 2048² one exports at 1×.

Raw 16-bit always exports at native size, because enlarging an archive copy is
meaningless.

Exports are uncompressed for maximum compatibility — a 2048² composite is about
12 MB. There is no LZW/Deflate option on purpose: compressed TIFFs are lossless
but behave unpredictably in Office.

---

## Batch a whole folder

Under **Channels** on the left: pick a folder, and every `.oir` in it goes
through the *same* pipeline as the file on screen — same colours, same names,
same bar, same style. Companion `_00001` part-files and non-`.oir` files are
skipped; a corrupt file is reported and does not stop the run.

Results come back as thumbnails. **Click one to load it into the main viewer**
with the settings the batch used, so you are looking at the file that was
written rather than a re-guess.

### Levels: the one choice that matters scientifically

- **Match this** (default) — every file gets the same black and white point as
  the open file. This is the only way brightness stays comparable between
  panels of a figure.
- **Auto each** — every file is stretched on its own 0.1–99.9 %. Each looks
  good alone; **brightness is then not comparable between files.**

### Where results go

With the File System Access API (Chrome), files are written into a
`scalebar_export/` subfolder inside the folder you picked. Otherwise each TIFF
downloads normally.

A web page cannot open Finder or Explorer — there is no browser API for it. The
**Show the folder** button reopens the OS folder chooser rooted at the export
folder, which is as close as the browser allows.

---

## Honesty features

These exist because a figure tool that quietly hides problems is worse than no
tool:

- **Contrast is linear only.** Black point and white point, nothing non-linear.
  The metadata `.txt` records the values used.
- **Clipping is flagged.** If a channel saturates at its bit depth on more than
  0.1 % of pixels, the top bar says so. Fine for a figure; do not quantify
  intensity from it.
- **Empty channels are flagged, not hidden.** A channel with no signal keeps all
  its controls — you may want to see it yourself, and in a batch this row is the
  only place to set the colour and name for a channel that is dark here and
  bright in the next file.
- **A fixed µm bar on a different magnification is flagged.** If the bar would
  exceed 75 % or fall under 2 % of a file's width during a batch, that file is
  listed.

---

## Browser support

| | Read `.oir` | Preview & single export | Batch read | Write into your folder |
|---|---|---|---|---|
| Chrome / Edge | yes | yes | yes | yes |
| Safari | yes | yes | yes | no — downloads instead |
| Firefox | yes | yes | yes | no — downloads instead |

Fonts load from Google Fonts and Fontshare. Offline they fall back to system
faces; nothing else changes.

---

## Command-line companion

`cli/oir_to_tif_scalebar.py` does the same job headlessly, for scripting or a
cluster. It needs `numpy`, `tifffile` and `pillow`.

```bash
python cli/oir_to_tif_scalebar.py IMAGE.oir --outdir out --bar 50
python cli/oir_to_tif_scalebar.py IMAGE.oir --bar 100 --pos bl --no-label --colors B,-,M
```

It writes per-channel 16-bit TIFFs with real calibration, greyscale and
composite versions with the bar burned in, and a metadata report.

---

## Tests

See [`tests/README.md`](tests/README.md). The suites load `index.html` and pull
the shipped functions out of it, so they test the published file. You supply
your own `.oir`; none is committed.

```bash
cd tests && npm install && npm test
```

---

## Notes

- No image from your data is included in this repo. If you want a screenshot in
  the README, add one you are happy to publish.
- `LICENSE` is MIT with your name on it. Change or delete it if that is not what
  you want.
