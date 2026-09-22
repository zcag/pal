# Disk Space

What is taking the space, and what to do about it. A root (your home
folder, a mounted volume, any folder) is scanned into a tree and drawn
as a **treemap**: boxes inside boxes, area by size, the biggest first,
each folder's own children faintly inside it. Enter zooms into a box,
Backspace out, the arrows walk the boxes by position. Mark boxes and
trash them together. Beside the map: the biggest files and folders as
lists, and cleanup suggestions (caches, stale build folders, old
downloads, the Trash) with their sizes.

## The palettes

| palette | what |
| --- | --- |
| Disk Space (`space`) | Where to look: Home, every mounted volume with its free space, the folders scanned before with their age and size, `Scan a folder…` with the path typed in the bar, and Cleanup suggestions. Enter opens the map (scanning first when there is no scan); `cmd+enter` the largest files, `cmd+shift+l` the largest folders, `cmd+shift+r` scans again, `cmd+shift+d` forgets a saved scan |
| Disk Map (`space-map`) | The treemap (below) |
| Largest Files (`space-largest`) | The biggest files under the last scanned root (or the one a link or a row names), the kind as a tag, a filter by kind; open, reveal, Quick Look, show in the map, copy path, info, and a multi-select trash |
| Largest Folders (`space-folders`) | The biggest folders under the root with their file counts and share; Enter shows one in the map |
| Cleanup Suggestions (`space-cleanup`) | User caches (`~/Library/Caches`, `~/.cache`), Xcode's DerivedData and simulator caches, the package caches (npm, Bun, Cargo, Gradle, pip), `node_modules` and cargo `target` folders untouched for `stale_days`, downloads older than that, the Trash; each with its size and one destructive action that asks first |

## The map

```
~ › proj › pal                       8.05 GB · 8 files  scanned 2 h ago  2 marked
┌──────────────────┬─────────────┐  ● ✓ target       4.24 GB   53%
│ target  4.24 GB  │ .git 2.6 GB │  ● .git           2.60 GB   32%
│ ┌──────────────┐ │ ┌─────────┐ │  ● ✓ node_mod…    1.20 GB   15%
│ │ debug        │ │ │ pack    │ │  ● app           12.0 MB  0.1%
│ └──────────────┘ ├─────────────┤  ● README.md       24 KB <0.1%
│                  │ node_modules│
└──────────────────┴─────────────┘
node_modules · 1.20 GB (15%) · 1 file · modified 1 mo ago · Folder
↑↓←→ focus  ⏎ zoom  ⌫ up  M mark  ␣ look  ⌘D trash  I info  C colour
```

- **The board**: the folder's children as squarified boxes (Bruls,
  Huizing, van Wijk 2000: sorted largest first, each strip laid along
  the shorter side of what is left and taking items while its worst
  aspect ratio does not get worse), so boxes stay near square. The first
  40 by size are drawn, the rest fold into one "N more items" box so the
  areas still add up. A box big enough shows its name and size, and its
  own children faintly inside it (the SpaceSniffer look); a folder's
  colour is the kind that weighs most below it (WinDirStat's colouring),
  or, with `colour = "depth"`, its place among the siblings with the
  nested boxes in their parent's hue (DaisyDisk's ring). The focused box
  wears the accent ring; a marked one the trash tint and a check.
- **The strip** beside it: the same children as rows (name, size,
  share), the focused one lit; a click on a row focuses it, on a box
  zooms into it (a file: focuses it). The crumbs above are clickable.
- **The footer**: the focused box's name, size and share, count,
  modification age and kind; then the keys.

| keys | action |
| --- | --- |
| `enter` | Zoom into the focused folder; open a file |
| `cmd+enter` | Reveal in Finder / show in the file manager |
| `backspace`, `-` | Zoom out |
| `up` `down` `left` `right`, `hjkl` | Focus the box in that direction (the nearest across the edge, straight ahead over off to the side) |
| `tab`, `shift+tab` | Next / previous box by size (reaches the slivers) |
| `m` | Mark or unmark for the trash; the marked total shows in the header |
| `cmd+d` | Move to Trash: the focused box, or every marked one together (the DaisyDisk collector), after a confirm naming the count and size |
| `space` | Quick Look (macOS) |
| `cmd+o`, `cmd+c` | Open, Copy path |
| `i` | Info as a detail level: kind, path, both sizes, count, share, modified, owner |
| `cmd+l` | Largest files under this folder |
| `c`, `a` | Colour by kind or depth; sizes on disk or apparent (both write the setting) |
| `cmd+r` | Rescan this folder (the root: everything); while a scan runs, stop it |

Escape leaves the map, as in every view level. `cmd+backspace` and
`cmd+i` are the shell's own in a view (pop, detail), so the map's trash
is `cmd+d` as in Files and its info is `i`.

## Scanning

A scan is a Bun walk of the extension's own worker: every directory's
entries listed and stat'ed in parallel with the others in flight,
adding each file's size to every ancestor as it lands, so the map is
drawn **live** while the scan runs (pushed every 250 ms with `view.update`,
the boxes gliding as the sizes settle). Both sizes are kept: allocated
(`blocks * 512`, what deleting frees; the default) and apparent
(`size`); the `sizes` setting picks the one shown, `a` flips it. A
hard-linked file counts once (by inode). Other file systems are skipped
unless `cross_devices` is on, but macOS firmlinks (`/Users`,
`/Applications` on the Data volume, from `/usr/share/firmlinks`) are
always crossed, so a scan of Macintosh HD sees your files without
walking every mounted disk image. Symlinks are never followed. A folder
that cannot be read is counted ("3 unreadable" in the header); on macOS
that is usually Full Disk Access for `~/Library/Mail` and the like.

Per directory the 256 biggest files are nodes and the rest fold into
one "N smaller files" node, so a million-file home stays ~800 k nodes
(130 MB of heap).

**Measured on this Mac** (M-series, APFS, 2026-09-22): `~` with 1.07 M
files in 150 k folders, 283 GB: the Bun walk **6.4 to 7.2 s** (the
sync variant 3.5 times slower), `du -sk ~` **28.5 s**, `mdfind` 2.5 s
but it only knows 185 k of the 313 k files under `~/proj` (Spotlight
skips node_modules, hidden folders and more) and gives no per-file
sizes without a second pass, so it is out. `~/proj` (313 k files, 100 GB):
the walk 1.1 to 1.3 s, `du` 1.2 s. The walk's totals match `du -sk`
to the block once hard links are counted once (96.2 GB both).

## Persistence

When a scan lands, the tree is **packed** into the extension's storage:
the biggest nodes under a size cut (every ancestor of a kept node is at
least as big, so the kept set is a subtree from the root), each as
`[name, dir, alloc, size, files, mtime, kind, kids]`, ~60 bytes a node,
shrunk until it fits 56 KB; the four most recent roots are kept under
the 256 KB cap. Reopening a root draws that at once with "scanned 2 h
ago" in amber for the partial tree; Rescan is `cmd+r`. A directory whose
children were cut says so in the packed form, and a zoom into it scans
**that folder alone** (the subtree replaced in place, the map following
live), so a saved scan is browsable to any depth. A trash takes the node
out of every tree that holds it and saves.

## What we took from each

- **SpaceSniffer**: the look. Boxes inside boxes with a folder's own
  children drawn inside it, a click zooms, the map updating while the
  scan runs. Its rectangles keep a border and a label strip; ours keep a
  hairline and a name-and-size label when the box has room.
- **WizTree**: speed from the file system's own structure (the MFT on
  NTFS). APFS has no readable equivalent, and Spotlight is incomplete,
  so the speed comes from a breadth-parallel walk instead (numbers
  above); the lesson kept is "the whole disk in seconds, drawn as it
  comes", not a progress bar and then a picture.
- **WinDirStat**: the treemap next to a tree (our side strip) and the
  colour by file type, with a folder taking the colour of what weighs
  most below it; its cushion shading is not reproduced (the view tree
  draws flat tints, which read better at 470 px).
- **DaisyDisk**: colour by depth (the ring, `colour = "depth"`), and
  the **Collector**: mark things as you browse and delete them together,
  the total shown while you collect (`m`, "Trash marked (3, 1.2 GB)").
- **GrandPerspective, Disk Inventory X**: colour by kind as the default,
  reveal and Quick Look on any box.
- **Baobab**: a root chooser of the mounted volumes with their free
  space before the map.
- **`dust`**: the biggest-first ordering everywhere, the share next to
  each size, and folding the small remainder into one line rather than
  hiding it.
- **`ncdu`**: keyboard-first browsing (zoom in and out, a delete with a
  confirm) and a rescan of one directory (`r`) rather than the whole
  tree.
- **`duc`**: scan once, browse later. Our packed tree in storage and the
  subtree rescan are its database and its refresh.
- **The squarified treemap** (Bruls, Huizing, van Wijk, 2000): the
  algorithm as published, in `layout.ts`, pure; the strips it produces
  are drawn as nested flex stacks weighted by their px extents (a
  `flex` weight and a `height` on a `stack`, added to the view tree for
  this), so the split is exact at the panel's width and the map needs
  no absolute positioning.

Docker images are not listed: the docker extension exposes no size to
other extensions, and reading `docker system df` here would be a second
Docker client.

## Links

- `pal://space/scan?root=~/proj` opens the map of a folder, scanning it
  first when there is no scan (`rescan=1` scans again).
- `pal://space/largest?root=~/Downloads` opens the largest files under
  a folder.

## Settings

`[extensions.space]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `sizes` | `allocated`, `apparent` | `allocated` | What the boxes and rows measure. |
| `colour` | `kind`, `depth` | `kind` | What colours a box. |
| `cross_devices` | boolean | `false` | Walk into other file systems under the root. |
| `largest` | 10 to 1000 | `100` | Rows in Largest Files and Largest Folders. |
| `stale_days` | 1 to 365 | `30` | When a build folder or a download counts as stale. |

For the tests, `PAL_SPACE_TRASH` names a stand-in for Finder's delete
(`gio trash` on Linux) taking the path, or `--empty`.

## Files

`layout.ts` the squarified strips, the flex grouping and the spatial
neighbour (pure); `scan.ts` the tree, the walk, the kinds, the packed
form; `render.ts` the map as a view tree; `rows.ts` the list rows;
`index.ts` the palettes, the scans and the picks; `fixture.ts` the
gallery fixture (a made-up home).
