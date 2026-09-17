# Home Assistant

Home Assistant over its REST API (`/api/states`, `/api/services`, one
`/api/template` render for areas), with a long-lived access token. Three
palettes: the entities, the services, the areas.

## Palettes

**Home Assistant** (`entities`) is live: every entity of the `domains`
setting, listed again whenever the panel shows, so a light's state at
the root is the current one and `kitchen light` finds it from the root.
Favourites come first in their order, then the domains in the setting's
order, names sorted within. A row is the friendly name; the subtitle is
the domain and the area (when the entity has one); the entity id, domain
and area are keywords; the accessories are the state (a coloured tag for
`on`, `off`, `open`, `locked`, `playing` and the other known states, the
value with its unit otherwise) and when it last changed. The icon is the
domain's glyph; a light that is on is a dot in its colour (`rgb_color`,
else warm white). The filter dropdown scopes it: All entities (the
`domains` setting), Every domain, then Lights, Switches, Sensors, Binary
sensors, Climate, Media players, People, Scripts, Automations, Scenes.
The detail pane (lazy, asked when the cursor rests) shows the entity,
its state, when it changed and its first attributes.

**Home Assistant Services** (`services`) is every service from
`/api/services`, by domain then name, the id (`light.turn_on`) as an
accessory and a keyword, HA's name and description when it gives them.
`enter` opens a form: the target as a select of the entities the service
takes (no field for a service without a target), then the service's
fields from its description (a `select` selector is a select, a
`boolean` one a checkbox, the rest text with the example as placeholder
and a number's range in the help line). The submit calls the service
with the values coerced by selector and toasts what changed; a number
field that is not one comes back on the form. Listed once an hour.

**Home Assistant Areas** (`areas`) is every area that has an entity,
with the count; `enter` lists those entities. Listed once an hour.

## Keyboard

The first action of a row is `enter`, the second `cmd+enter`; `cmd+k`
has them all. By domain on an entity row:

| domain | actions |
| --- | --- |
| light | Toggle, Turn on, Turn off, Brightness (`cmd+b`: presets of 10 / 25 / 50 / 75 / 100 %, the current one tagged) |
| switch, fan, input_boolean, humidifier | Toggle, Turn on, Turn off |
| climate | Set temperature (a form: the temperature with the entity's range, the mode from its `hvac_modes`), Turn on, Turn off |
| cover | Open, Close, Stop (Close first while open) |
| lock | Lock, Unlock (both ask first; the one that changes the state comes first) |
| media_player | Play or Pause, Next track, Previous track, Volume (`cmd+u`: presets), Turn off |
| scene | Activate |
| script | Run |
| automation | Trigger, Enable or Disable |
| button, input_button | Press |
| vacuum | Start, Return to dock |
| anything else (sensor, binary_sensor, person, ...) | Copy value |

On every entity row:

| keys | action |
| --- | --- |
| `cmd+c` | Copy entity id |
| `cmd+shift+a` | Show attributes: a level with the state and every attribute as rows, each copying its value (`cmd+c` its name) |
| `cmd+o` | Open in Home Assistant: the automation or script editor, the history page for the rest |

On a service row: `enter` Call (the form, then the call), `cmd+c` Copy
service id. On an area row: `enter` Show entities.

A service call keeps the panel open and lists again, so the row shows
the new state, with a toast naming it; a call that fails is a failure
toast with HA's answer. Entity ids are the row ids, so an item hotkey
toggles one entity without showing pal:

```toml
[palettes.home-assistant-entities.item_hotkeys]
"light.kitchen" = "ctrl+alt+k"
```

## Setup

In Home Assistant, your profile, Security, create a long-lived access
token. In pal, Settings › Extensions › Home Assistant: the URL with its
scheme (`http://homeassistant.local:8123`) and the token, which the
config file keeps as a `keychain:` or `env:` reference, never the value.

Settings, `[extensions.home-assistant]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `url` | text | unset | Where Home Assistant answers, scheme included. |
| `token` | secret | unset | A long-lived access token. A `keychain:` or `env:` reference in the file. |
| `domains` | list | `light`, `switch`, `climate`, `media_player`, `cover`, `lock`, `fan`, `scene`, `script`, `automation`, `sensor`, `binary_sensor`, `person`, `input_boolean` | The domains listed at the root, in this order. |
| `favorites` | list | `[]` | Entity ids pinned to the top, in this order, whatever their domain. |
| `timeout` | number (s) | `5` | How long one request may take. |

When something is wrong every palette is one inert hint row that says
what and where to fix it: no URL, a URL without a scheme, no token, a
`keychain:` or `env:` token that did not resolve, a rejected token (401),
a host that did not answer within the timeout, or one that could not be
reached. A URL that redirects (an `http://` one behind a proxy answering
301 to `https://`) is followed with the token kept, and the log says
which URL to set. An HA that refuses the template API leaves the rows
without areas and the Areas palette with a hint row.

Needs the network: every request goes to the URL you set, nothing else.

## What it does not do

- No WebSocket: states are read on each show, not pushed, so a change
  made elsewhere shows on the next show or `cmd+r`.
- No entity editing, no dashboards, no history graphs: `cmd+o` opens the
  right page in Home Assistant for those.
- No arbitrary brightness or volume: the presets are the five steps; the
  service form (`light.turn_on` with `brightness_pct`) takes any value.
- A collapsed group in a service's description (HA's "advanced" section)
  is left out of the form.

## Platforms

macOS and Linux, the same on both: everything is HTTP.
