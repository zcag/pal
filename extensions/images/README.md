# Images

Compress, resize, convert, rotate, crop, strip metadata, make an icon set,
read the text: what Raycast's TinyPNG and Image Modification do, with the
tools on the machine first and TinyPNG only when you give it a key. One
input palette: the rows are the images at hand, every operation is an
action on a row, and every result is written next to its source with a
suffix and its path copied.

## What is at hand

Before you type, the palette lists:

| section | rows |
| --- | --- |
| Finder selection | the image files selected in the front Finder window (AppleScript, 100 ms); a selected folder lists its images (200 at most, not recursive). macOS only |
| Clipboard | an image on the clipboard (the file pal's history keeps for it, as "Clipboard image"), or the images of a copied file list |
| Results | what this session wrote, newest first, with the saving as a tag; a result is a file row too, so it can be worked on again |

With more than one image an **All N images** row leads, and every
operation on it runs over all of them; `tab` (or `x` with nothing typed)
marks rows for the same. A typed path lists a file (`~/Desktop/a.png`), a
folder's images (`~/Desktop/site/`, with its own All row) or the
completions of the last segment; anything else filters the rows by name.
Each row shows a thumbnail, the size and the pixel size; the detail pane
(open by default) shows the picture at 256 px over the info: dimensions,
format, colour space and profile, camera, lens, exposure, date, location
(the last five from `exiftool` when it is installed; `sips` knows make,
model, copyright and artist).

## The operations

| keys | action | writes |
| --- | --- | --- |
| `enter` | Compress | `name-compressed.ext`, lossy at `quality`; a file no encoder can shrink writes nothing and says so |
| `cmd+enter` | Optimise for web | `name-web.ext` (or `.webp` / `.avif` per `web_format`): the long side capped at `web_max`, encoded at `quality`, metadata stripped; a view with the before and after of every image, the saving as a tag, a bar, and the total at the foot; the view follows a long batch as it lands |
| `cmd+l` | Compress losslessly | `name-compressed.ext`, the pixels untouched |
| `cmd+t` | Compress with TinyPNG | `name-compressed.ext` through the API (with a key) |
| `cmd+shift+r` | Resize… | a level: half, quarter, double, fit in 2000 or 1000, widths, a height; or type `800`, `x600`, `800x600` (fit inside), `50%`, `2x`. `name@0.5x.ext`, `name-800w.ext`, `name-800x600.ext`; `@2x` strips an existing `@Nx` from the stem, half of an `@2x` stem is the bare name |
| `cmd+shift+v` | Convert… | a level: PNG, JPEG, WebP, AVIF, HEIC, PDF, TIFF, GIF, each row naming the tool that writes it (a missing one says what to install and takes no action). `name.ext` |
| `cmd+shift+o` | Rotate or flip… | 90° either way, 180°, mirror left-right or top-bottom. `name-rotated90.ext`, `name-flipped-h.ext` |
| `cmd+shift+a` | Crop or pad… | centred crops to 1:1, 16:9, 4:3, 3:2, 9:16 (`name-square.ext`, `name-16x9.ext`); pad to a square with `pad_color` (`name-padded.ext`) |
| `cmd+shift+m` | Strip metadata | `name-stripped.ext`: EXIF, XMP, comments and the ICC profile gone; PNG and JPEG losslessly in pal itself, other formats through `exiftool` or ImageMagick |
| `cmd+g` | Grayscale | `name-gray.ext` |
| `cmd+shift+f` | Make an icon set | a folder `name-icons/` with `name.iconset/` (the ten files `iconutil` wants), `name.icns` (macOS), `favicon.ico`, `favicon-16.png`, `favicon-32.png`, `apple-touch-icon.png` (180), `android-chrome-192.png`, `android-chrome-512.png`; a non-square image is centre-cropped first |
| `cmd+shift+t` | Copy text (OCR) | the text in the image onto the clipboard (Vision on macOS, `tesseract` on Linux) |
| `cmd+shift+i` | Copy info | the pane's lines as text |
| `cmd+c` | Copy path | the paths of the marked rows, one per line |
| `cmd+shift+p` | Copy image | the picture onto the clipboard (PNG and JPEG; other formats as a file) |
| `cmd+o`, `cmd+shift+e` | Open, Reveal in Finder | |
| `cmd+shift+z` | Restore original | on a result that replaced its source: the kept copy goes back |
| `cmd+d` | Move result to Trash | on a result written next to its source; asks first, the source stays |

Every operation ends the same way: the result's path on the clipboard
(the paths, one per line, for a batch; the image itself when the input
was the clipboard, so a screenshot compresses and pastes), the panel
down, and the HUD saying what happened and with what: "Compressed
photo.png: 1.4 MB → 312 KB (−78%), pngquant · path copied". A batch that
takes longer than eight seconds answers with a progress toast and finishes
behind the panel; the HUD then sums it up. With `replace` on the result
takes the source's place and the source is copied to
`~/Library/Caches/pal/images/originals/` first, so Restore original always
has something to restore; nothing is ever deleted. A clipboard image's
result goes to `~/Library/Caches/pal/images/clipboard/` (the source is
pal's history file).

## Which tool does it

The `tools` setting is the order the encoders are tried; one left out is
never used. Every result says which tool made it. On macOS `sips` (in
every install) does the geometry (resize, rotate, flip, crop, pad,
grayscale) whenever it is listed, and converts to PNG, JPEG, TIFF, GIF,
BMP, PDF, HEIC, AVIF and ICO; ImageMagick (`magick`, or `convert` on
version 6) does all of that elsewhere and is the fallback for everything.
The compressors:

| format | lossy | lossless |
| --- | --- | --- |
| PNG | `pngquant` (quality floor 25 under `quality`) | `oxipng`, `optipng`, ImageMagick (never sips: it re-encodes a palette PNG as RGBA and grows it) |
| JPEG | `cjpeg` (mozjpeg's if `brew install mozjpeg`, else libjpeg-turbo's; decoded through `djpeg`), ImageMagick, sips | `jpegtran` |
| WebP | `cwebp`, ImageMagick | `cwebp -lossless` |
| AVIF | `avifenc`, sips, ImageMagick | `avifenc -l` |
| HEIC | sips, ImageMagick | |
| GIF | | `gifsicle` |

A source an encoder cannot read is decoded to PNG first (sips, ImageMagick,
`dwebp`, `avifdec`, `heif-convert`); SVG is rasterised to PNG. The
empty listing names up to three encoders worth installing when none of the
sources are there. TinyPNG (`tinypng_api_key`, from tinypng.com/developers,
500 compressions a month free) takes PNG, JPEG, WebP and AVIF and posts the
file to `api.tinify.com`.

## Settings

`[extensions.images]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `replace` | boolean | `false` | Write over the source; a copy is kept for Restore original. |
| `quality` | 1 to 100 | `80` | For the lossy encoders. |
| `web_format` | `keep`, `webp`, `avif` | `keep` | What Optimise for web writes. |
| `web_max` | 100 to 10000 | `2000` | Optimise for web caps the long side at this many pixels. |
| `thumbnails` | boolean | `true` | A thumbnail on each row and in the pane (the core's own for PNG, JPEG and GIF; `sips -Z` or ImageMagick into `~/Library/Caches/pal/images/thumbs/` for the rest). |
| `pad_color` | hex | `#ffffff` | What Pad to a square fills with. |
| `tinypng_api_key` | secret | | Adds Compress with TinyPNG. |
| `tools` | list | every tool | The order the encoders are tried. |

## How it is made

`ops.ts` is pure: the formats, the output naming, `plan(job, input,
opts)` answering the steps (`{ tool, argv }`) for a job with the tools at
hand, the built-in JPEG and PNG strip (APPn and COM segments; the text,
time, EXIF and ICC chunks), and the parsers for `sips -g all`, `identify
-format` and `exiftool -j`. `exec.ts` finds the binaries, runs the steps
(a replace goes through a temp file, so a failed step leaves the source
whole), keeps the thumbnails, reads the Finder selection, writes the
clipboard, talks to TinyPNG and keeps the originals. `index.ts` is the
rows, the levels, the view and the picks. The tests draw their own PNGs
(`host/test/extensions/images-png.ts`) and turn one into a JPEG through
sips or ImageMagick.

## What it does not do

- Batch across folders recursively, or watch a folder.
- Edit pixels beyond the list above (no filters, no annotations, no
  background removal).
- Read RAW files: sips can, but the palette lists the common formats only.
- A per-file quality: `quality` is one setting; run again with another.

## Platforms

macOS (sips in every install; the encoders from Homebrew) and Linux
(ImageMagick and the encoders from the package manager; the Finder
selection is macOS only, the clipboard and typed paths work everywhere).
