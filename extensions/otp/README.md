# Verification Codes

One-time codes out of your recent text messages, read straight from
Messages' database (`~/Library/Messages/chat.db`, read-only, one SQLite
query per listing). The last `hours` of incoming messages are scanned; a
message counts when it talks about a code (code, kod, şifre, OTP, PIN,
parola, passcode, verification, doğrulama, código, token and so on) and
carries a run of 4 to 8 digits that is not part of an amount, a date, a
time or a phone number; Google's `G-123456` is taken by its digits.

The row is the sender as Messages knows it (a shortcode like `NORTHBANK`,
an alphanumeric originator, a number or an email; a number or an email
that is in Contacts shows the contact's name, read from the AddressBook
database the same permission covers), the message text is the subtitle,
the code is a green tag on the right with how long ago it arrived.
Sections are Today and Earlier, newest first. A live palette: listed
again on every show, so the code that just arrived is at the top, and the
codes are root results while they are in the window (type the sender or
the code itself). The detail pane (`cmd+i`) has the whole message, the
code, the sender and when it was received.

## Keyboard

| keys | action | what |
| --- | --- | --- |
| `enter` | Paste code | hides, then pastes the code into the app that was in front |
| `cmd+c` | Copy code | copies the code |
| `cmd+shift+c` | Copy sender | copies the sender as Messages stores it (`+1 555 0142`, not the contact's name) |

## Setup

**Full Disk Access.** Messages keeps the database behind it, and without
it SQLite answers "authorization denied": the palette then has one row,
"Full Disk Access needed", whose action opens System Settings, Privacy &
Security, Full Disk Access. Add pal there and open the palette again.
There is no other way to read Messages.

**Paste** is a synthesised Cmd+V, which macOS only delivers from a process
on the Accessibility list; without it pal shows the system prompt once
and a toast saying what to grant. Copying needs nothing.

A database SQLite reports locked (Messages writing at that moment) is
copied aside with its `-wal` and `-shm` and the copy is read, then
removed. A database that is not there ("No Messages database"), or any
other read error, is one inert row with the reason. Messages on Ventura
and later keeps many texts in `attributedBody` rather than `text`; both
are read.

Settings, `[extensions.otp]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `hours` | number, 1 to 720 | `24` | How far back to scan. |
| `senders` | list | `[]` | Senders never listed, as Messages shows them (`AKBANK`, a number, an email); case does not matter. |
| `db` | path | `~/Library/Messages/chat.db` | The database to read. `~` is expanded. |
| `contacts` | path | empty | An `AddressBook-v22.abcddb` for names; empty reads every source under `~/Library/Application Support/AddressBook`. |

The bar item **Latest code** puts the newest code on the strip for a
minute after it arrives (green, the sender and the message as its
tooltip); a click copies it. Hidden the rest of the time.

## What it does not do

- Codes from email, authenticator apps or the browser: only Messages
  (SMS and iMessage) is read.
- Codes without a keyword near them: a bare six-digit text is not listed,
  since it could be anything.
- Codes longer than 8 digits or shorter than 4, or spaced ones (`123 456`
  is read as two numbers).
- Delete or mark messages; the database is opened read-only.

## Platforms

macOS only: the palette reads Messages, which Linux does not have (there
the palette is one "Unavailable" row and the bar item is hidden). Needs
Full Disk Access to read, and Accessibility to paste.
