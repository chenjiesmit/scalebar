# Tests

These run in Node against `../index.html` itself — the suites pull the shipped
parser and render functions straight out of the HTML, so they test the file you
publish rather than a copy that can drift.

## Setup

```bash
cd tests
npm install
```

You also need one Olympus `.oir` to test against. It is never committed:

```bash
cp /path/to/your/file.oir tests/fixture.oir
# or point at it per run
OIR=/path/to/your/file.oir node test_ui.mjs
```

`test_emptybatch.mjs` needs a file with **at least one channel that has no
signal**; it skips with a message otherwise.

## Run

```bash
npm test              # all five
node test_ui.mjs      # or one at a time
```

## What each covers

| file | what it checks |
|---|---|
| `test_parser.mjs` | container parsing: pixel size, objective, dyes, channel count, per-channel statistics, clipping detection, and the hand-written TIFF encoder |
| `test_render.mjs` | scale-bar geometry in pixels vs the requested µm, at 1× and 2×, in two corners |
| `test_ui.mjs` | the whole interface in jsdom: load a file, channel rows, levels, names, burn-in checkboxes, the length graticule, layout, preflight block, and that all five export buttons fire |
| `test_batch.mjs` | folder batch against a fake directory handle: file filtering, a deliberately corrupt file, thumbnails, click-to-view, and that batch output is **byte-identical** to the single-file export |
| `test_emptybatch.mjs` | that a channel which is empty in the open file still carries its colour and name into other files of a batch |

`test_parser.mjs` can additionally prove byte-exact decoding if you drop a
reference dump at `tests/raw_check.bin` (little-endian uint16, channel-major).
Generate it with numpy from whatever you trust as ground truth; without it that
one assertion is skipped and the rest still run.
