# Calendar

Your next days of events, one key to join the call. One live palette,
**My Schedule** (`calendar-schedule`), over the core's calendar capability:
EventKit on macOS, so every account Calendar.app has (iCloud, Google,
Exchange) is one store and one permission; `khal` on Linux. Sections by
day (Today, Tomorrow, This week, Later), the current event tagged `now`
and the next one `in 12 min`, a `Join` tag where the event has a Zoom,
Meet, Teams or Webex link. The palette is live with a 60 s ttl: the rows
are current on every show, and the store is read at most once a minute.

## Rows

| part | what |
| --- | --- |
| icon | the calendar's colour as a dot |
| title | the event's title |
| subtitle | the time range and the location: `10:00 – 10:30 · Room 4`, `All day`, `All day, until Fri 18 Sep` |
| accessories | `now` or `in 12 min` on the current or next event, `declined` or `maybe` for your reply, the head count, `Join` when there is a call |
| keywords | the calendar, the location, the section and the day, so `work`, `room 4` or `fri` finds the row |

Events that have ended are gone; an all-day one lasts until its midnight.
The last row is **New event**. The filter dropdown is one entry per
calendar, read when the host loads.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Join call when the event has a link, else Open in Calendar (macOS); Copy event details on Linux without a call |
| `cmd+shift+c` | Copy conference link |
| `cmd+c` | Copy event details: title, when, where and the link as text |
| `ctrl+x` | Delete event, or Delete this occurrence of a repeating one; asks first; macOS only |
| `cmd+i` | Details: the notes as markdown, when, the calendar and its account, the location, the call, the organizer, every attendee with their reply, whether it repeats |
| `tab` | Cycle the calendars |

**New event** is a form: a title, a day in words (`today`, `fri`, `next
mon`, `2026-09-20`, `20 sep`), a start and an end (`14:30`, `2pm`, `1430`;
an end before the start is the next day), an all-day checkbox, the
calendar, a location and notes. A field that does not parse shows its
complaint and keeps what was typed.

## Setup

macOS asks for calendar access once: while it has not, the palette is one
row, **Grant calendar access**, whose Enter shows the system prompt; a
denial is one row that opens Privacy & Security > Calendars. Linux needs
`khal` on PATH, with a `[locale]` section that sets `datetimeformat`, or
a timed New event is refused with the format to set.

Settings, `[extensions.calendar]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `calendars` | list | `[]` | Calendar names (or ids) to list; empty is every calendar. Also narrows the filter dropdown. |
| `days` | number | `7` | How many days from today. |
| `hide_declined` | boolean | `true` | Leave out invitations you declined. |

## What it does not do

- Accept or decline an invitation: EventKit has no public API for the
  current user's reply.
- Toggle a calendar's visibility, or list reminders.
- Delete or open an event on Linux: khal has no command for either.
- Edit an event: New event creates; changes are made in the calendar app.

## Platforms

macOS (EventKit, the Calendars permission) and Linux (`khal`).
