# Screenshots

Take a screenshot from the panel, and find the ones you took. Three
Capture rows lead the palette; under them the screenshots folder, newest
first, each with a thumbnail, its pixel size, its file size and its age.
A live palette: the folder is read again on every show, so the shot you
just took is there, and its name finds it at the root.

## Capturing

| row | macOS | Linux |
| --- | --- | --- |
| Capture area | `screencapture -i`: drag a selection; space switches to a window, Escape cancels | `grim -g "$(slurp)"` |
| Capture window | `screencapture -i -W`: click the window; space switches to a selection | the same as an area |
| Capture screen | `screencapture`: every display, now | `grim` |

The panel hides first, then the tool runs. Enter captures to a file in
the folder (`Screenshot 2026-09-17 at 14.03.22.png`, the name macOS
gives) or to the clipboard, whichever the `destination` setting says;
`cmd+c` on the row takes the other destination for that one shot;
`cmd+enter` waits `timer` seconds first (`-T`). The HUD then says
`Screenshot saved: <name>` or `Copied to the clipboard`; a capture you
cancelled says nothing. The shutter sound is off unless `sound` is on
(`-x`). Linux needs `grim` and `slurp` on PATH (and `wl-copy` for the
clipboard); without them the Capture section is one hint row.

## The rows

Every `.png`, `.jpg`, `.jpeg`, `.mov` and `.mp4` in the folder whose
name starts with `Screenshot`, `Screen Shot`, `Screen Recording` or
`grim-` (every image and recording with `all_files` on), newest first,
at most `limit`. The row: the file name, `1440×900 · 234 KB` (the pixel
size read off a PNG's header), the age on the right, a 48 px thumbnail
for a picture (the app's `icon://` file route) and a glyph for a
recording.

| keys | action |
| --- | --- |
| `enter` | Open |
| `cmd+enter` | Reveal in Finder / Show in file manager |
| `cmd+c` | Copy image: the file itself onto the clipboard, so a paste in a chat drops the picture |
| `cmd+shift+c` | Copy path |
| `cmd+m` | Copy as markdown image: `![Screenshot 2026-09-17 at 14.03.22](/Users/x/Desktop/Screenshot%202026-09-17%20at%2014.03.22.png)` |
| `cmd+shift+t` | Copy text (OCR): the text in the picture, through the core's OCR (Vision on macOS, `tesseract` on Linux); `ocr_concealed` keeps it out of the clipboard history |
| `cmd+d` | Move to Trash, after a confirm |
| `tab`, `x` | Mark rows: Open, Reveal, Copy image, Copy path and Move to Trash run over all of them |

The detail pane (`cmd+i`) shows the picture itself over its name,
folder, size, pixels and the time it was taken.

The root's Now section (the empty panel) offers a screenshot taken in
the last two minutes as `Screenshot taken 40 s ago`: Enter opens it,
`cmd+c` copies the image, `cmd+m` the markdown tag.

## Settings

| key | default | what |
| --- | --- | --- |
| `destination` | `file` | `file` or `clipboard`: where Enter on a Capture row sends the shot |
| `folder` | (system) | Where captures land and the list reads. Empty: `defaults read com.apple.screencapture location`, else `~/Desktop`; on Linux `~/Pictures/Screenshots` when it exists, else `~/Pictures` |
| `timer` | `3` | Seconds the delayed capture waits |
| `sound` | `false` | Play the shutter sound |
| `all_files` | `false` | List every image and recording in the folder, not only the ones named like macOS's captures |
| `limit` | `50` | At most this many recent rows |
| `ocr_concealed` | `false` | Text copied by OCR is concealed (never enters the clipboard history) |
