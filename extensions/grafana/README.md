# Grafana

Grafana over its HTTP API with a service account token: the dashboards,
the alerts firing and pending with their silences, a PromQL prompt
against Prometheus, and a bar item counting what is firing. `multi`, so
a second Grafana is `[instances."grafana@work"]` with its own `url` and
`token`.

## Palettes

**Grafana Dashboards** (`grafana`) is every dashboard the token can see
(`/api/search?type=dash-db`), starred first, then as Grafana sorts them.
A row is the title; the subtitle is the description, or the folder when
there is none; the folder is a blue tag and the first two tags follow
it; the uid, the tags and the folder are keywords. `enter` opens it in
the browser with the `time_range` setting appended (`from=now-6h&to=now`)
when set, `cmd+enter` asks for a range in a form (from, to, kiosk),
`cmd+f` opens it in kiosk mode, `cmd+s` stars or unstars it (the token's
own stars, `/api/user/stars`: a service account has its own list, which
is what sorts first here), `cmd+c` copies the URL, `cmd+u` the uid, and
`→` drills into the dashboard's folder. The filter (`tab`) is All,
Starred, Folders; Folders lists every folder with a dashboard in it and
`enter` drills in. Listed every 15 minutes, `cmd+r` sooner.

The detail pane (lazy) shows the description, the folder, the tags, the
time range and refresh, the panels by type, and the first three time
series panels (`sparklines` setting) drawn: as panel images when the
image renderer plugin is installed (`/render/d-solo/<uid>?panelId=…`,
probed once per run through `/api/plugins/grafana-image-renderer/settings`,
in the panel's theme), else as sparklines drawn by the extension from
the panels' own queries, one `/api/ds/query` call for the whole pane
over the dashboard's time range (a panel whose expression uses a
template variable is skipped; Grafana's `$__` macros are fine). The
caption is the first series' last value in the panel's unit.

**Grafana Alerts** (`grafana-alerts`) is live: every alert instance
firing or pending, from the ruler's Prometheus-compatible API
(`/api/prometheus/grafana/api/v1/rules?state=firing&state=pending`, the
one that carries the rule uid), with the Alertmanager's view of what a
silence covers (`/api/alertmanager/grafana/api/v2/alerts`) and the
active silences (`/api/v2/silences`). Firing first, then by rule and
labels. A row is the rule's name; the subtitle the rendered summary
(else the instance's labels); a red `firing` or amber `pending` tag, the
severity, a `silenced` tag, and since when. The detail pane has the
summary and description, the rule (a link), the state and severity, the
labels, the value, the rule's health when it is not ok, the silence and
the dashboard the rule points at (`view_url`, or `__dashboardUid__` with
its panel). The filter is Firing and pending, Firing, Pending, Silenced;
Silenced lists the covered instances and then the active silences
themselves, each with Expire.

`enter` opens the rule in Grafana, `cmd+enter` its dashboard, `cmd+s` /
`cmd+shift+s` / `cmd+d` silence the instance for 1 hour / 4 hours / 1
day (asking first; the matchers are the rule's uid plus the instance's
own labels, `createdBy: pal`), `cmd+e` expires the silence, `cmd+c`
copies the summary, `cmd+l` the labels. A silence needs the Editor
role: a Viewer token gets a failure toast naming it. Listed on show, not
twice within 30 s.

**Grafana Query** (`grafana-query`) is an input palette: what you type
runs as a PromQL instant query (`/api/ds/query`) against the Prometheus
datasource (`datasource` setting by uid or name, else Grafana's
default), one row per series with Grafana's display name, the value on
the right and the labels in the pane; a parse error is a calm hint with
Prometheus's message. Before you type, the saved queries (`queries`
setting, `Name = expr` lines): `enter` runs one (the prompt with the
expression typed), `cmd+backspace` removes it. On a result `enter`
copies the value, `cmd+enter` the series with its value, `cmd+shift+a`
every series, `cmd+c` the expression, `cmd+o` opens Explore with it,
`cmd+s` saves it under a name (written to the setting). The same
expression is not asked again within 15 s, and a query still running
when the next keystroke comes is abandoned.

## Bar item

`grafana/alerts`: the Grafana glyph with the firing count in red and the
pending count in amber as segments, hidden by its rules while both are
zero (a firing instance under a silence does not count). It publishes
`grafana/firing` and `grafana/pending` for anyone's expressions.
Refreshed every minute, on show, wake and the network coming back; the
listing is shared with the palette for 20 s. The popover lists the
instances by state with a colour rail (grey once silenced), the summary,
the severity and the age: `enter` opens the rule, `o` the dashboard,
`s` / `f` / `d` silence for 1 hour / 4 hours / 1 day (asking first), `s`
on a silenced one expires the silence, `c` copies the summary, `a` opens
the alert list, `p` the palette, `r` refreshes, arrows and `j`/`k` move,
a click focuses a row.

## Links

`pal://grafana/query?expr=up%20%3D%3D%200` opens the prompt with the
expression typed; `pal://grafana/open?uid=cagdas-home&from=now-24h&kiosk=1`
opens a dashboard (the `time_range` setting when `from` is absent).

## Setup

In Grafana, Administration › Service accounts: add one with the Viewer
role (Editor if you want to silence from pal or star dashboards), add a
token. In pal, Settings › Extensions › Grafana: the URL with its scheme
and the token, which the config file keeps as a `keychain:` or `env:`
reference, never the value.

Settings, `[extensions.grafana]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `url` | text | unset | Where Grafana answers, scheme included. |
| `token` | secret | unset | A service account token. A `keychain:` or `env:` reference in the file. |
| `time_range` | text | unset | Appended to a dashboard's URL as `from=…&to=now` when set (`now-6h`); empty opens the dashboard's own range. |
| `datasource` | text | unset | The Prometheus datasource the prompt runs against, by uid or name; empty is Grafana's default. |
| `queries` | list | five `Name = expr` lines | The saved queries listed before you type. |
| `sparklines` | number | `3` | How many time series panels the pane draws; `0` turns it off. |
| `timeout` | number (s) | `8` | How long one request may take. |

When something is wrong every palette is one inert hint row that says
what and where to fix it: no URL (its `enter` opens Settings on the
field), a URL without a scheme, no token, a `keychain:`/`env:` token
that did not resolve, a rejected token (401), a host that did not
answer within the timeout, or one that could not be reached. A URL that
redirects (an `http://` one behind a proxy answering 301 to `https://`)
is followed with the token kept, and the log says which URL to set.
The bar item hides on no setup (the strip has no room for a hint) and
goes stale on anything else.

The endpoints, all under the URL you set: `/api/search`,
`/api/dashboards/uid/<uid>`, `/api/user/stars/dashboard/uid/<uid>`,
`/api/prometheus/grafana/api/v1/rules`, `/api/alertmanager/grafana/api/v2/alerts`,
`/api/alertmanager/grafana/api/v2/silences` (and `/silence/<id>`),
`/api/datasources`, `/api/ds/query`, `/api/plugins/grafana-image-renderer/settings`,
`/render/d-solo/<uid>`. Needs the network: every request goes there,
nothing else.

## What it does not do

- No Loki: the prompt is PromQL against a Prometheus datasource.
- No editing of dashboards or rules; `enter` opens the right page.
- Stars are the service account's, not your browser user's: Grafana
  keeps them per user and a token belongs to its account.
- Pending instances are not in the Alertmanager yet, so a silence that
  would cover one shows only once it fires.

## Platforms

macOS and Linux, the same on both: everything is HTTP.
