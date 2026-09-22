# 1Password

Your 1Password items through the `op` CLI. One `op item list --format
json` per listing, kept for `ttl` seconds so the vault filters and a
Refresh inside the ttl do not run the CLI (and its unlock prompt) again;
`cmd+r` past the ttl asks it again. No secret is ever in a row, the index
or a log: a pick runs `op item get` for that one field and puts the value
on the clipboard.

One palette, **1Password** (`items`).

## Rows

| part | what |
| --- | --- |
| icon | a glyph by category: login and password, secure note, card and bank account, identity, SSH key, API credential, server and database, and so on |
| title | the item's title |
| subtitle | the vault, then the username (`Personal · alex@example.com`) |
| accessories | `favorite` (amber) for a favourite, then the primary website's host |
| keywords | the website hosts, the username, the category, the vault and the tags, so `github.com` finds the login |
| detail pane | vault, category, username, the website as a link, tags and the update time (`cmd+i`) |

Favourites come first with their tag, then the rest by title. With
`vaults` set, the palette has a filter per vault (All vaults first) and
lists only those.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Copy password: `op item get <id> --fields label=password --reveal`; "Copied password" in the HUD |
| `cmd+u` | Copy username: the `username` field |
| `cmd+t` | Copy one-time code: `op item get <id> --otp`, the current TOTP |
| `cmd+o` | Open in 1Password: `onepassword://view-item?i=<item>&v=<vault>&a=<account>`, the app's own link (the account from `op account list`, when there is one or `account` names it) |

An item without the field (a secure note has no password, a login
without TOTP has no one-time code) keeps the panel open with a toast
carrying the CLI's message.

## Setup

Install the [1Password CLI](https://developer.1password.com/docs/cli/get-started/)
(`brew install 1password-cli` on macOS) and turn on the desktop app
integration (1Password, Settings, Developer, "Integrate with 1Password
CLI"). The first call from pal makes 1Password ask whether to allow it,
which is why the palette lists only once you open it (`lazy: "visit"`):
nothing is asked at pal's start or on its first show, and a reinstalled
pal (a new signature) asks again the next time you open the palette.
After that every call that needs the vault shows 1Password's own unlock
prompt (Touch ID on a Mac), and pal waits up to a minute for it. A
terminal's `eval $(op signin)` session is that shell's only and never
reaches pal. `op` is looked up on PATH,
then in `/opt/homebrew/bin`, `/usr/local/bin` and `/usr/bin`, since the
app under launchd has a bare PATH.

Signed in or not:

- Nothing signed in (or no account set up for the CLI at all) is one row,
  "Sign in to 1Password", whose action opens the CLI's sign-in page. Sign
  in, then `cmd+r`.
- `op` not installed is one row whose action opens the install page.
- A vault filter with nothing in it, or an account with no visible items,
  is one "No items" row.

Settings, `[extensions.onepassword]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `account` | text | empty | Passed as `--account` to every call: a shorthand, sign-in address, account id or user id. Empty uses the CLI's default account. |
| `vaults` | list | `[]` | Only these vaults are listed, and each is a filter in the palette (All vaults first). Empty lists every vault with no filter. Read when the extension loads, so a change shows after the host restarts. |
| `ttl` | number (seconds) | `300` | How long the item list is kept before `op` is asked again. |

Nothing beyond the panel: the CLI does its own unlocking, and the
clipboard is the core's.

## What it does not do

- No autofill and no typing into a field: the value goes to the
  clipboard, you paste it. The copy is a plain one, not marked concealed
  the way the 1Password app marks its own, so pal's Clipboard History
  records it like any copy; delete the entry there when that matters.
- No item creation or editing, no vault management: the app does those.
- No other fields than password, username and one-time code: a custom
  field or a note's body is not offered.
- No SSH agent, no `op run`: this is the item list and three fields.

## Platforms

macOS and Linux, wherever the `op` CLI runs. The desktop app integration
(the biometric prompt) is the app's feature on both and is what pal
needs; a service account token in `OP_SERVICE_ACCOUNT_TOKEN` works
without the app.
