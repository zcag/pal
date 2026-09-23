# Calendar

Today at a glance, one key to join the call. Two live palettes and a bar
item over one source and one cache:

- **Today** (`calendar-today`): the day's events in order with the time,
  how long, and where each stands (`in 12 min`, `now, 25 min left`,
  `over`); tomorrow's under their own section once nothing timed is left
  today; a **Nothing else today** row naming the next event's day.
- **My Schedule** (`calendar-schedule`): the week, sectioned Today /
  Tomorrow / This week / Later, the current event tagged `now` and the
  next one `in 12 min`; New event at the end (system calendar).
- **Quick Add Event** (`calendar-quick`): one typed line, `standup
  tomorrow 10:00`, read back as a row while you type and added on Enter;
  a root query nothing matched offers it as a fallback row.
- **Upcoming** (`calendar/upcoming`, the bar item): the next event as
  `Standup  in 12m` on the menu bar or sketchybar, `25m left` while it
  runs (with `in 8m` for the one due next), hidden when nothing starts
  within ten hours; muted far off, amber inside fifteen minutes, red
  inside five; a dot when there is a call to join. A
  click joins that call (or opens Calendar); a hover peek opens the day:
  the rows still to come, Join on the calls, tomorrow folded; Enter joins.

## Sources

| `source` | what | where |
| --- | --- | --- |
| `system` | the core's calendar capability: EventKit on macOS (every account Calendar.app has: iCloud, Google, Exchange; one store, one permission), `khal` on Linux | `core/src/calendar.rs` |
| `google` | Google Calendar API v3 read directly, per account, `events.list` with `singleEvents` and the `conferenceData` join links; a working-location chip (`eventType: workingLocation`, "Home" on every weekday) is not an event and is left out | `google.ts` |
| `auto` (default) | `google` once an account is listed, else `system` | `source.ts` |

**Google needs a token, and the command is the secret's owner.** Each
account is one entry of the `accounts` setting, `name = command`: the
command prints an access token for the Calendar API on stdout, either a
bare token or the JSON an OAuth endpoint answers (`access_token`,
`expires_in`). pal runs it through `sh -c`, keeps the token in memory
until the expiry it stated (30 minutes for a bare one), mints again on a
401, and never writes a token or a refresh token anywhere. What the
command is, is yours: gcloud (below), a helper that holds a refresh
token in the keychain, a token broker behind ssh. There is no OAuth flow inside pal: a Google
client id would have to ship with it, and a read-only token from a
command you already trust is the honest shape for a launcher.

With `gcloud`: `gcloud auth application-default login
--scopes=https://www.googleapis.com/auth/calendar.readonly,https://www.googleapis.com/auth/cloud-platform`
once (gcloud's plain login does not carry the Calendar scope), then
`gcloud auth application-default print-access-token` is the command. If
Google answers 403 asking for a quota project, `gcloud auth
application-default set-quota-project <project>` with the Calendar API
enabled on it. Not verified here: the owner's accounts go through a
broker, so treat the gcloud path as the documented one, not a tested one.

```toml
[extensions.calendar]
accounts = [
  "work = gcloud auth application-default print-access-token",
  # a broker on another box: quote the remote command for its shell, the `?` in the url is a glob there
  "personal = ssh archer \"curl -s 'http://127.0.0.1:8776/token?aud=calendar'\"",
]
```

An account reads its primary calendar. To read others, write the entry
as a table in the config file with the calendar ids from
`calendarList`:

```toml
[[extensions.calendar.accounts]]
name = "work"
token_command = "gcloud auth application-default print-access-token"
calendars = ["primary", "team@group.calendar.google.com"]
```

Calendars are named `<account>:<id>` (`work:primary`) in the filter
dropdown and the `calendars` setting; the account's name is the row's
source. A Google event opens in the browser (its `htmlLink`) and cannot
be deleted from here, and New event is off: the token may be read-only,
and creating an event with attendees is Google sending mail as you.

One account being away is not the other's problem: its error goes to
the log and the rest list. Every account away keeps the last events read
and says so in a hint row (the bar item goes `stale`); nothing read yet
is one hint row with the reason.

## Rows

| part | Today | My Schedule |
| --- | --- | --- |
| icon | the calendar glyph in the calendar's colour | the calendar's colour as a dot |
| title | the event's title | the same |
| subtitle | `10:00 – 10:30 · 30 min · Room 4`, `All day` | `10:00 – 10:30 · Room 4`, `All day, until Fri 18 Sep` |
| accessories | the state first: `in 12 min` (blue), `now, 25 min left` (green), `over` (grey), `today` for an all-day one; then `declined` / `maybe`, the head count, `Join` | `now` or `in 12 min` on the current or next event, `declined` / `maybe`, the head count, `Join` |
| keywords | the calendar, the location, the state, the section | the calendar, the location, the section, the day |

My Schedule drops events that have ended; Today keeps them as `over`, in
order, so the day reads whole. Both hide declined invitations by default,
and so does the bar's popover (below), which lists what is still to come.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Join call when the event has a link, else Open in Calendar (macOS) or Open in Google Calendar (a Google account); Copy event details on Linux without a call |
| `cmd+shift+c` | Copy conference link |
| `cmd+c` | Copy event details: title, when, where and the link as text |
| `ctrl+x` | Delete event, or Delete this occurrence of a repeating one; asks first; macOS, system calendar only |
| `cmd+i` | Details: the description as text (HTML stripped for a Google event), when with the duration, the calendar and its account, the location, the call, the organizer, every attendee with their reply, whether it repeats |
| `tab` | Cycle the calendars |

A call is Google's `conferenceData` video entry point (else
`hangoutLink`), or the first Zoom, Meet, Teams, Webex, Jitsi, Whereby or
GoTo meeting link in the location, then the description; the system
source looks in the url, the location and the notes. Outlook safelinks
are unwrapped; a Zoom marketing page or an agenda doc does not count.

**New event** (system calendar) is a form: a title, a day in words
(`today`, `fri`, `next mon`, `2026-09-20`, `20 sep`), a start and an end
(`14:30`, `2pm`, `1430`; an end before the start is the next day), an
all-day checkbox, the calendar, a location and notes.

**Quick Add Event** is the same write from one line (`quick.ts`): a title
first, then in any order a day (`tomorrow`, `fri`, `next tue`, `20 sep`,
`2026-09-20`, `on monday`), a time or a range (`10:00`, `2pm-3pm`, `14:00
to 15:30`, `9-10am`), `for 45m` (else `default_length`, 30 minutes), `at
<place>` (free text at the end), `@ <calendar>` anywhere (`in <calendar>`
too, when a writable calendar starts with the word; an `in` in a title
stays), `all day`. No time makes it an all-day event; no day means today,
or tomorrow once the time has passed (an amber `tomorrow` tag says so).
The row reads it back (`Fri 18 Sep 14:00 to 15:00 · Room 4 · Home
calendar`, the calendar's colour on the glyph, a `date` accessory); a line
that is only a day, or nothing, is a hint row. A calendar name nothing
matches falls to the default and the row says so. Works with the system
source; a Google source refuses the write as the form does.

## The bar item

`calendar/upcoming` speaks for the first event that has not ended, timed
(all-day ones skipped unless `hide_all_day` is off), not declined, and
starting within `horizon_hours`; a running one counts until it ends. The
event's name is the title and the time is a segment after it (`in 12m`
before the event, `25m left` while it runs), so the target's `max_chars`
clip shortens a long name and never the time; the segment has no colour
of its own and takes the item's. While an event runs, the next one due
under the same rules (the one the strip would show once this ends) adds a
second segment, `in 8m`, in that event's own state colour, with its name
in the tooltip (`Weekly sync, 10:12 – 10:42 (Work), Enter joins; then
Design review, 11:00 – 12:00 (Team)`) and in the popover: the strip has
one name's width and segments are never clipped, so a second name stays
off it. A click joins the running event's call, not the next one's. Its
state is `far` (outside `near_minutes`), `near`, `warning` (from
`warn_minutes`), `critical` (from `urgent_minutes`) or `running`; the
boundaries are inclusive. The default colours retain the original
behaviour: `muted`, `muted`, `amber`, `red`, then `green`, each a
manifest rule over `calendar.phase` that Settings > Bar overrides by id. `badge: "dot"` when there is a call.
The tooltip is the title, the time range and the calendar. sketchybar
draws the same colours through the bar module's map.

The core asks every five minutes and on wake, the network coming back
and the minute tick (`refresh: { every: 300, on: ["minute", "wake",
"network"] }`). A minute tick renders from the cache, which is what keeps
`in 12m` counting down without a fetch; every other reason fetches. A
render from the cache is well under a millisecond (`bar/render` through
the host measured at 0.1 ms in the tests); the first fetch is the
source's: about 80 ms for a week from EventKit, 250 to 350 ms for two
Google accounts whose token commands hop over ssh.

**The popover** (`view.ts`, a `{ view }` menu, 420 px wide) is the day
at a glance: today's events still to come as rows, each with the start
over the end in the time column, the calendar's colour as a thin bar, the
title over the place, the head count and the calendar, and at the right
how far off it is (`in 12 min`, blue inside the hour) or, on the one
running, `ends in 24 min` on an elevated card. A row with a call carries a
green **Join** button (solid while the call runs). All-day events are a
line of badges above the rows; a `maybe` or `declined` badge sits by a
title you have not accepted. Tomorrow is folded under a header row
(`Tomorrow · 3 events · Thu 17 Sep`) that opens on `t` or a click and
lists its events in the same shape; it opens by itself on a clear day,
under a **Nothing today** card naming the next event. When the cache is
what is shown after a failed fetch, an amber `showing the last events
read` badge says so with the error. While the popover is up a 30 s tick
redraws it from the cache (no fetch), so the minutes keep counting.

| keys | action |
| --- | --- |
| `enter` | Join the focused event's call; without one, Open in Calendar (macOS) or Open in Google Calendar (a Google account), else Copy event details; on a clear day, Open Calendar |
| `up`, `down` | Move the ring between the rows (tomorrow's too once it is open); a click on a row focuses it |
| `j` | Join the next call in the list |
| `t` | Show or fold tomorrow; a click on its header does the same |
| `o` | Open Calendar (the app on macOS; the day's page on calendar.google.com for a Google account) |
| `r` | Refresh: forget the cache, the next render fetches |
| `cmd+c` | Copy the focused event's details |
| `cmd+shift+c` | Copy the focused event's conference link |
| a click on **Join** | Join that row's call, whatever the ring is on |

A hover peek or hotkey that opens the popover starts it fresh: the ring on
the first row, tomorrow folded.

## Setup

macOS asks for calendar access once (system source): while it has not,
the palettes are one row, **Grant calendar access**, whose Enter shows
the system prompt; a denial is one row that opens Privacy & Security >
Calendars. Linux needs `khal` on PATH, with a `[locale]` section that
sets `datetimeformat`, or a timed New event is refused with the format to
set. Google needs nothing on the machine but the token command.

Settings, `[extensions.calendar]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `source` | select | `auto` | `auto`, `system`, `google` (above). |
| `accounts` | list | `[]` | Google accounts as `name = command`, or tables `{ name, token_command, calendars }` in the file. |
| `calendars` | list | `[]` | Calendar names (or ids, `work:primary` for Google) to list; empty is every calendar. Also narrows the filter dropdown. |
| `days` | number | `7` | How many days from today My Schedule lists (two at least, so Today has tomorrow). |
| `hide_declined` | boolean | `true` | Leave out invitations you declined, everywhere. |
| `horizon_hours` | number | `10` | The bar item shows the next event only when it starts within this many hours (the root's Now row too). |
| `hide_all_day` | boolean | `true` | The bar item speaks for timed events only (the root's Now row too). |
| `default_length` | number | `30` | How long a Quick Add event lasts when no end or `for` is typed (minutes). |

`upcoming` item settings, `[bar.items."calendar/upcoming".settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `near_minutes` | number | `60` | The near state starts here; warning and critical still take precedence. |
| `warn_minutes` | number | `15` | The item enters its warning state this many minutes before the event. |
| `urgent_minutes` | number | `5` | The item enters its critical state this many minutes before the event. |

## What it does not do

- Accept or decline an invitation: EventKit has no public API for the
  current user's reply, and the Google tokens this is built for are
  read-only.
- Create, edit or delete a Google event; toggle a calendar's visibility;
  list reminders.
- Delete or open an event on Linux: khal has no command for either.
- Run an OAuth flow: the token command is the whole of the setup.

## Platforms

macOS (EventKit, the Calendars permission), Linux (`khal`), and Google
Calendar on either through a token command.
