# Weather

Current conditions for one named place, using Open-Meteo's public geocoding and forecast APIs. Set **Location** to a city, region or postal code; it needs no account, token or Home Assistant installation.

The bar stays absent in ordinary weather. Rain, fog, wind, severe conditions, or a temperature outside the comfort band (10 to 30 by default: the item's `ordinary`, `cold` and `hot` rules under Settings > Bar) bring it back with a condition glyph and temperature. Its popover shows the current details, the next eight hourly readings from the current hour, a four-day forecast, sunrise and sunset, plus map and refresh keys.

Settings, `[extensions.weather]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `location` | text | (none) | The place: a name, optionally narrowed by region or country (`London, Ontario`). |

The bar item is hidden in ordinary weather; `show = "always"` under
`[bar.items."weather/weather"]` keeps the reading on the strip then too,
muted, so the forecast stays a click away (docs/config.md).
