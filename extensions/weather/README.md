# Weather

Current conditions for one named place, using Open-Meteo's public geocoding and forecast APIs. Set **Location** to a city, region or postal code; it needs no account, token or Home Assistant installation.

The bar stays absent in ordinary weather. Rain, fog, wind, severe conditions, or a temperature outside the configured comfort band bring it back with a condition glyph and temperature. Its popover shows the current details, the next eight hourly readings from the current hour, a four-day forecast, sunrise and sunset, plus map and refresh keys.

Settings, `[extensions.weather]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `location` | text | (none) | The place: a name, optionally narrowed by region or country (`London, Ontario`). |
| `low` | number (°C) | `10` | Cold below: the bar surfaces under it. |
| `high` | number (°C) | `30` | Hot above: the bar surfaces over it. |
| `notable_conditions` | list | `[]` | Extra WMO weather codes that surface even inside the band. |
| `bar_show` | `notable` / `always` | `notable` | When the bar item is drawn: in notable weather, or always (the reading in ordinary weather too, muted). |
