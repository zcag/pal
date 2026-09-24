# Third-party notices

What pal ships that is not its own, each under its own license. pal
itself is MIT (LICENSE).

## Bun

The extension host is the Bun runtime (https://bun.sh), shipped as the
`pal-bun` sidecar next to the pal binary. `app/scripts/fetch-bun.sh`
fetches the release pinned there. MIT, Copyright (c) Oven, Inc.

## Nerd Fonts symbols

The icon font in the panel and the menu bar is "Symbols Nerd Font Mono"
from Nerd Fonts (https://github.com/ryanoasis/nerd-fonts), as a WOFF2 in
the webview and a TTF for the menu bar renderer. MIT for the font and the
patcher; the icon sets inside carry their own licenses, listed with the
font in `app/src/assets/fonts/LICENSES`.

## Kenney Boardgame pack v2

The playing cards of the game surfaces' kit (`/__pal/cards/`,
`app/src-tauri/surface-kit/cards/`), from the Boardgame pack v2 by Kenney
Vleugels (https://www.kenney.nl), shipped in the app bundle's
`Resources/surface-kit` with its license (`LICENSE-kenney.txt`). CC0 1.0
(public domain dedication); credit is not required and is given here.

## mediaremote-adapter

The system-wide Now Playing source on macOS is
https://github.com/ungive/mediaremote-adapter: `mediaremote-adapter.pl`
and `MediaRemoteAdapter.framework`, built from the commit pinned in
`app/scripts/fetch-mediaremote.sh` and shipped in the app bundle's
`Resources/mediaremote` together with its LICENSE.

BSD 3-Clause License. Copyright (c) 2025, Jonas van den Berg and
contributors. Redistribution and use in source and binary forms, with or
without modification, are permitted provided that the conditions of that
license are met; the full text is in the bundled LICENSE file.
