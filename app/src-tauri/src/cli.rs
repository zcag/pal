//! `pal [toggle|show|hide|settings|reload|quit]`. No subcommand runs the app. With one, and
//! an instance already running, the argv reaches that instance through the
//! single-instance plugin's channel and this process exits at once; with
//! none running the app starts and applies the command once the page has
//! loaded. Wayland has no global hotkey API, so this is what a compositor
//! keybind runs.
//!
//! `pal link <url>` and its readable twins (`open`, `run`, `form`, `copy`,
//! `paste`, `hud`, `toast`, `confetti`, `command`, `call`) are the
//! `pal://` routes from a shell (docs/design/links.md): each spells its
//! link (`Cmd::link`), this process refuses a bad one with the reason and
//! exit 2 before sending, and the instance runs it with no confirm card
//! (`deeplink::handle_trusted`). Every link's outcome is the HUD's.
//!
//! `pal install|update|remove|list` work the extension store in this process
//! (`Cmd::run_store`: results on stdout, one `pal\t<reason>` line on stderr
//! and exit 1 on failure), then `reload` reaches the running instance so
//! its host picks the change up. `install` takes a store name (looked up
//! at pal.cagdas.io, `pal_core::extensions::REGISTRY`) or an explicit
//! source; `--from SPEC` is the source with no lookup.
//!
//! `pal instance list|add|remove` (docs/design/instances.md): `list` reads
//! the config file in this process (every `[instances.*]` table, the
//! default of each name first); `add` and `remove` are link twins
//! (`pal://instance/add/<name>/<suffix>`, `pal://instance/remove/<key>`),
//! file edits the running instance makes, so its host reloads the
//! extension's instances at once.
//!
//! `pal action NAME` and the v1 subcommands (`pick`, `run`, `meta`, ...)
//! are for the scripts written against pal v1: `compat.rs`, in this
//! process, no instance needed.
//!
//! `pal bar ...` (bar/mod.rs): `list` and `json` read the feed file the
//! instance writes, in this process; `click`, `hover`, `action`, `render`
//! and `sync` reach the instance (sketchybar's click and hover scripts
//! run them).
//!
//! `pal state ...` (states.rs): the table, `get`, `eval`, `json` and
//! `watch` read the feed file in this process; `set` and `reset` reach the
//! instance.
//!
//! `pal pick` (pick.rs): the rows on stdin, the panel as the picker, the
//! choice on stdout; the one subcommand with an answer, over a socket of
//! its own that the handed-over argv names (`--reply`).

use clap::{Parser, Subcommand};
use pal_core::extensions::Store;
use tauri::{AppHandle, Manager};

#[derive(Parser)]
#[command(version, about = "pal launcher")]
pub struct Cli {
    #[command(subcommand)]
    pub cmd: Option<Cmd>,
}

#[derive(Subcommand, Clone, Debug, PartialEq, Eq)]
pub enum Cmd {
    /// Show the panel if hidden, hide it if shown.
    Toggle,
    /// Show the panel.
    Show,
    /// Hide the panel.
    Hide,
    /// Open the settings window, on a page when one is named.
    Settings {
        /// `overview`, `general`, `palettes`, `extensions`, `bar` or `about`.
        page: Option<String>,
    },
    /// Restart the extension host, so it reloads every extension from disk.
    Reload,
    /// Quit the running instance (flushes its state, stops the extension host).
    Quit,
    /// Install an extension: a name from the store at pal.cagdas.io, a directory, github:user/repo[/subdir][@ref], or a github.com URL.
    Install {
        /// A store name (`wordle`), or a source as with --from.
        spec: Option<String>,
        /// The source itself (a directory, github:user/repo[/subdir][@ref], or a github.com URL), never looked up as a store name.
        #[arg(long, conflicts_with = "spec", required_unless_present = "spec")]
        from: Option<String>,
    },
    /// Fetch an installed extension's source again; every one with a source when no name is given.
    Update { name: Option<String> },
    /// Remove an installed extension (its settings stay in the config file).
    Remove { name: String },
    /// List the installed extensions: name, version and source, one per line.
    List,
    /// Instances of a multi extension (a second account): list, add or remove one.
    Instance {
        #[command(subcommand)]
        cmd: InstanceCmd,
    },
    /// Act on the value on stdin: copy, paste, open, type, cmd, or a plugins/actions/NAME script (the script tier).
    Action { name: String },
    /// Bar items: list them, click or hover one, run an action, render again, re-apply sketchybar.
    Bar {
        #[command(subcommand)]
        cmd: BarCmd,
    },
    /// States: the table of named variables; set one by hand, reset it, evaluate an expression, watch changes.
    State {
        #[command(subcommand)]
        cmd: Option<StateCmd>,
    },
    /// Run a pal:// link as written (docs/links.md); no confirm card, this is your own hand.
    Link {
        /// `pal://open/emoji/emoji?q=smile`; `--list` prints every route instead.
        #[arg(required_unless_present = "list")]
        url: Option<String>,
        /// Print the route table and exit.
        #[arg(long)]
        list: bool,
    },
    /// Open the panel inside a palette (pal://open/EXT/PALETTE), or a url with the OS opener (--url).
    Open {
        /// `emoji/emoji`: the extension and palette names from its pal.json.
        #[arg(required_unless_present = "url")]
        palette: Option<String>,
        /// Typed into the search box.
        #[arg(short, long)]
        query: Option<String>,
        /// One of the palette's filters.
        #[arg(long)]
        filter: Option<String>,
        /// A url, path or app for the OS opener instead (pal://open?url=).
        #[arg(long, conflicts_with_all = ["palette", "query", "filter"])]
        url: Option<String>,
    },
    /// Run one item as a pick, the panel down (pal://run/EXT/PALETTE/ID).
    Run {
        /// `apps/apps/com.apple.Safari`: extension, palette and the row's id.
        item: String,
        /// One of the row's action ids; the first otherwise.
        #[arg(short, long)]
        action: Option<String>,
        /// The level's args as JSON, for a row inside a drill-in.
        #[arg(long)]
        args: Option<String>,
    },
    /// Open the form an item's pick answers, prefilled (pal://form/EXT/PALETTE/ID?field=value).
    Form {
        /// `quicklinks/quicklinks/create`: extension, palette and the row's id.
        item: String,
        /// The action that answers the form.
        #[arg(short, long)]
        action: Option<String>,
        /// `field=value` per field to prefill.
        #[arg(value_name = "FIELD=VALUE")]
        fields: Vec<String>,
    },
    /// Put text on the clipboard (pal://copy?text=); stdin when no text is given.
    Copy { text: Option<String> },
    /// Paste text into the app in front (pal://paste?text=); stdin when no text is given.
    Paste { text: Option<String> },
    /// One line in the HUD (pal://hud?text=).
    Hud { text: String },
    /// A toast in the panel when it is up, else the HUD (pal://toast?title=&message=).
    Toast { title: String, message: Option<String> },
    /// A celebration in the HUD (pal://confetti).
    Confetti { text: Option<String> },
    /// One of pal's own rows: settings, store, refresh, updates, theme, ... (pal://commands/ID).
    Command { id: String },
    /// Pick from the lines on stdin (or JSON rows {id,name,subtitle,icon}) in the panel; the chosen ids on stdout, exit 1 on Escape.
    Pick {
        /// The picker's title (the crumb).
        #[arg(short, long)]
        title: Option<String>,
        /// Several rows: x, shift+arrows or cmd+click mark them, Enter picks all.
        #[arg(short, long)]
        multi: bool,
        /// Typed into the search box first.
        #[arg(short, long)]
        query: Option<String>,
        /// Answer with this id at once, the panel never shown: checks the plumbing.
        #[arg(long, hide = true)]
        select: Option<String>,
        /// Internal: the socket the instance answers on (the CLI sets it in the handover).
        #[arg(long, hide = true)]
        reply: Option<String>,
    },
    /// A route an extension declares (pal://EXT/ROUTE?key=value).
    Call {
        /// `timer/start`: the extension and the route from its pal.json.
        route: String,
        /// `key=value` per parameter; repeat a key for an array.
        #[arg(value_name = "KEY=VALUE")]
        params: Vec<String>,
    },
}

/// Percent-encoding for a link's path part or query value: everything but
/// the unreserved set, so `/`, `?`, `&`, `=`, `+` and spaces are escaped.
const ENCODE: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC.remove(b'-').remove(b'_').remove(b'.').remove(b'~');

fn enc(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, ENCODE).to_string()
}

/// `k=v&k=v` from `(key, value)` pairs, encoded; empty for none.
fn query(pairs: &[(&str, &str)]) -> String {
    let q: Vec<String> = pairs.iter().map(|(k, v)| format!("{}={}", enc(k), enc(v))).collect();
    if q.is_empty() { String::new() } else { format!("?{}", q.join("&")) }
}

/// `KEY=VALUE` words as pairs; a word without `=` is a flag set to `1`.
fn pairs(words: &[String]) -> Vec<(&str, &str)> {
    words.iter().map(|w| w.split_once('=').unwrap_or((w.as_str(), "1"))).collect()
}

/// The text given, else stdin (for `pal copy`, `pal paste` in a pipe).
fn text_or_stdin(text: &Option<String>) -> String {
    text.clone().unwrap_or_else(|| {
        let mut s = String::new();
        let _ = std::io::Read::read_to_string(&mut std::io::stdin(), &mut s);
        s.trim_end_matches('\n').to_string()
    })
}

#[derive(Subcommand, Clone, Debug, PartialEq, Eq)]
pub enum StateCmd {
    /// One state's value, one line (`null` when unknown); exit 1 when there is no such state.
    Get { name: String },
    /// Set a state by hand: `true`, `false`, a number, or a string; until reset, or for a while.
    Set {
        name: String,
        value: String,
        /// How long: `90s`, `25m`, `1h30m`, `2h`, `1d` (a bare number is minutes).
        #[arg(long = "for", value_name = "DURATION")]
        for_: Option<String>,
        /// A time of day, `HH:MM`: today, or tomorrow when it has passed.
        #[arg(long, value_name = "HH:MM")]
        until: Option<String>,
    },
    /// Drop the manual value: the expression, the publisher or the default answers again.
    Reset { name: String },
    /// What an expression reads now (`"hour >= 9 and working"`), for writing one.
    Eval { expr: String },
    /// The whole table as JSON.
    Json,
    /// Stream `name<TAB>value` on every change.
    Watch,
}

/// `pal state set`'s value: JSON when it parses (`true`, `3`, `"x"`), else the text.
pub fn state_value(s: &str) -> serde_json::Value {
    serde_json::from_str(s).ok().filter(pal_core::states::is_scalar).unwrap_or_else(|| serde_json::Value::String(s.to_string()))
}

impl Cmd {
    /// The `pal://` link a link twin spells, `None` for the rest. `Link`
    /// passes its url through as written.
    pub fn link(&self) -> Option<String> {
        let path = |parts: &[&str]| parts.iter().map(|p| enc(p)).collect::<Vec<_>>().join("/");
        let s = crate::deeplink::SCHEME;
        Some(match self {
            Cmd::Link { url: Some(url), .. } => url.clone(),
            Cmd::Open { url: Some(url), .. } => format!("{s}://open{}", query(&[("url", url)])),
            Cmd::Open { palette: Some(p), query: q, filter, .. } => {
                let mut pairs = Vec::new();
                if let Some(q) = q { pairs.push(("q", q.as_str())); }
                if let Some(f) = filter { pairs.push(("filter", f.as_str())); }
                format!("{s}://open/{}{}", path(&p.split('/').collect::<Vec<_>>()), query(&pairs))
            }
            Cmd::Run { item, action, args } => {
                let mut pairs = Vec::new();
                if let Some(a) = action { pairs.push(("action", a.as_str())); }
                if let Some(a) = args { pairs.push(("args", a.as_str())); }
                format!("{s}://run/{}{}", item_path(item), query(&pairs))
            }
            Cmd::Form { item, action, fields } => {
                let mut pairs = Vec::new();
                if let Some(a) = action { pairs.push(("action", a.as_str())); }
                pairs.extend(self::pairs(fields));
                format!("{s}://form/{}{}", item_path(item), query(&pairs))
            }
            Cmd::Copy { text } => format!("{s}://copy{}", query(&[("text", &text_or_stdin(text))])),
            Cmd::Paste { text } => format!("{s}://paste{}", query(&[("text", &text_or_stdin(text))])),
            Cmd::Hud { text } => format!("{s}://hud{}", query(&[("text", text)])),
            Cmd::Toast { title, message } => {
                let mut pairs = vec![("title", title.as_str())];
                if let Some(m) = message { pairs.push(("message", m.as_str())); }
                format!("{s}://toast{}", query(&pairs))
            }
            Cmd::Confetti { text } => format!("{s}://confetti{}", text.as_ref().map_or(String::new(), |t| query(&[("text", t)]))),
            Cmd::Command { id } => format!("{s}://commands/{}", enc(id)),
            Cmd::Instance { cmd: InstanceCmd::Add { name, suffix, title, tint } } => {
                let mut pairs = Vec::new();
                if let Some(t) = title { pairs.push(("title", t.as_str())); }
                if let Some(t) = tint { pairs.push(("tint", t.as_str())); }
                format!("{s}://instance/add/{}/{}{}", enc(name), enc(suffix), query(&pairs))
            }
            Cmd::Instance { cmd: InstanceCmd::Remove { key } } => format!("{s}://instance/remove/{}", enc(key)),
            Cmd::Call { route, params } => format!("{s}://{}{}", path(&route.split('/').collect::<Vec<_>>()), query(&pairs(params))),
            _ => return None,
        })
    }

    /// The route table, for `pal link --list`.
    pub fn print_routes() {
        for spec in crate::deeplink::ROUTES {
            println!("{}://{:<36} {}", crate::deeplink::SCHEME, spec.pattern, spec.doc);
        }
    }
}

/// `pal instance list`: one line per instance the file describes,
/// `<key>\t<title>\t<state>`, grouped by extension with the default first
/// (`Config::instances_of`); an extension with no `[instances.*]` table
/// has one instance and is not listed. `off` is `enabled = false`.
pub fn instance_lines(config: &pal_core::config::Config) -> Vec<String> {
    use pal_core::config::instance;
    let names: std::collections::BTreeSet<&str> = config.instances.keys().filter(|k| instance::is_key(k) || instance::valid_name(k)).map(|k| instance::name_of(k)).collect();
    let mut out = Vec::new();
    for name in names {
        for (key, i) in config.instances_of(name) {
            let title = i.title.clone().unwrap_or_else(|| match instance::split(&key).1 {
                Some(suffix) => { let mut c = suffix.chars(); c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default() }
                None => String::new(),
            });
            let state = if !i.enabled { "off" } else if key == name { "default" } else { "on" };
            out.push(format!("{key}\t{title}\t{state}"));
        }
    }
    out
}

/// `ext/palette/id` as a link path: the first two parts are names, the
/// rest (an id may hold slashes) is one part, encoded.
fn item_path(item: &str) -> String {
    let mut it = item.splitn(3, '/');
    let (e, p, id) = (it.next().unwrap_or_default(), it.next().unwrap_or_default(), it.next().unwrap_or_default());
    format!("{}/{}/{}", enc(e), enc(p), enc(id))
}

#[derive(Subcommand, Clone, Debug, PartialEq, Eq)]
pub enum InstanceCmd {
    /// Every instance the config file describes, `<key>\t<title>\t<state>`, the default of each extension first.
    List,
    /// Add `[instances."<name>@<suffix>"]` (pal://instance/add/NAME/SUFFIX): a second account of a multi extension.
    Add {
        /// The extension's name (`gmail`).
        name: String,
        /// The instance's suffix (`work`): lowercase letters, digits, - and _.
        suffix: String,
        /// The display name ("Work"); the suffix capitalised otherwise.
        #[arg(short, long)]
        title: Option<String>,
        /// The tile's colour: red, orange, amber, green, teal, cyan, blue, indigo, violet, pink, slate or ink; picked from the suffix otherwise.
        #[arg(long)]
        tint: Option<String>,
    },
    /// Remove an instance (pal://instance/remove/KEY): its tables, storage, cache and ranking; the keychain items stay.
    Remove {
        /// `gmail@work`; the default instance is the extension itself and stays.
        key: String,
    },
}

#[derive(Subcommand, Clone, Debug, PartialEq, Eq)]
pub enum BarCmd {
    /// Every declared item, visible or not, with its last title.
    List,
    /// The item's last rendered state as JSON.
    Json { key: String },
    /// A click on the item: its popover, or its open action.
    Click {
        key: String,
        /// Where the click came from: `sketchybar` (the item's bounding rect is queried), `menubar`, or `x,y,w,h` in screen points.
        #[arg(long)]
        anchor: Option<String>,
    },
    /// The pointer entered or left the item (sketchybar's `mouse.entered` / `mouse.exited`).
    Hover {
        key: String,
        #[arg(long)]
        anchor: Option<String>,
        /// `enter` or `exit`; `$SENDER`'s `mouse.entered` / `mouse.exited` are read too.
        #[arg(long)]
        state: String,
    },
    /// Run one of the item's actions: a menu node's `action`.
    Action { key: String, action: String },
    /// Render the item again now.
    Render { key: String },
    /// Re-apply the sketchybar target (the end of a sketchybarrc).
    Sync,
}

impl Cmd {
    /// The commands that run in this process with no instance: `Some(status)`
    /// for one of them, `None` for the rest.
    pub fn run_compat(&self) -> Option<i32> {
        match self {
            Cmd::Action { name } => Some(crate::compat::action(name)),
            Cmd::Link { list: true, .. } => {
                Cmd::print_routes();
                Some(0)
            }
            // A link the grammar refuses never leaves this process: the reason, exit 2.
            cmd if cmd.link().is_some_and(|l| crate::deeplink::parse(&l).is_err()) => {
                let link = cmd.link().unwrap_or_default();
                eprintln!("pal\t{}\t{link}", crate::deeplink::parse(&link).err().unwrap_or_default());
                Some(2)
            }
            Cmd::Instance { cmd: InstanceCmd::List } => {
                let config = pal_core::config::ConfigFile::locate().load().config;
                for line in instance_lines(&config) {
                    println!("{line}");
                }
                Some(0)
            }
            Cmd::Bar { cmd: BarCmd::List } => {
                let feed = crate::bar::read_feed();
                for (key, e) in &feed.items {
                    let item = e.item.as_ref();
                    let state = match item {
                        None => "unrendered",
                        _ if e.held => "held",
                        Some(i) if i.hidden => "hidden",
                        _ if e.stale => "stale",
                        _ => "visible",
                    };
                    let title = item.and_then(|i| i.title.clone()).unwrap_or_default();
                    println!("{key}\t{state}\t{}\t{title}", e.title);
                }
                Some(0)
            }
            Cmd::State { cmd: None } => {
                let feed = crate::states::read_feed();
                let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
                for e in &feed.entries {
                    let source = match &e.source {
                        pal_core::states::Source::Manual => "manual".to_string(),
                        pal_core::states::Source::Expr => "expr".to_string(),
                        pal_core::states::Source::Published(who) => who.clone(),
                        pal_core::states::Source::Default => "default".to_string(),
                    };
                    let left = e.until.map(|u| left_text(u.saturating_sub(now) / 1000)).unwrap_or_default();
                    let note = e.error.as_deref().map(|x| format!("error: {x}")).or_else(|| e.description.clone()).or_else(|| e.expr.as_ref().map(|x| format!("= {x}"))).unwrap_or_default();
                    println!("{}\t{}\t{}\t{}\t{}", e.name, e.value, source, left, note);
                }
                for d in &feed.diagnostics {
                    eprintln!("{:?}\t{}\t{}", d.level, d.path, d.message);
                }
                Some(0)
            }
            Cmd::State { cmd: Some(StateCmd::Get { name }) } => match crate::states::read_feed().entries.iter().find(|e| &e.name == name) {
                Some(e) => {
                    println!("{}", e.value);
                    Some(0)
                }
                None => {
                    eprintln!("pal\tno state {name}");
                    Some(1)
                }
            },
            Cmd::State { cmd: Some(StateCmd::Json) } => {
                println!("{}", serde_json::to_string_pretty(&crate::states::read_feed().entries).unwrap_or_default());
                Some(0)
            }
            Cmd::State { cmd: Some(StateCmd::Eval { expr }) } => {
                // Against the feed's resolved values: the same table the instance holds.
                let mut s = pal_core::states::States::default();
                for e in crate::states::read_feed().entries {
                    let _ = s.publish(&e.name, "feed", e.value);
                }
                match s.eval(expr) {
                    Ok(v) => {
                        println!("{v}");
                        Some(0)
                    }
                    Err(e) => {
                        eprintln!("pal\t{e}");
                        Some(1)
                    }
                }
            }
            Cmd::State { cmd: Some(StateCmd::Watch) } => Some(crate::states::watch_feed()),
            Cmd::Bar { cmd: BarCmd::Json { key } } => match crate::bar::read_feed().items.get(key) {
                Some(e) => {
                    println!("{}", serde_json::to_string_pretty(e).unwrap_or_default());
                    Some(0)
                }
                None => {
                    eprintln!("pal\tno bar item {key}");
                    Some(1)
                }
            },
            _ => None,
        }
    }

    /// The store commands, run in this process: `Some(changed)` for one of
    /// them (printed, exit status set on failure), `None` for the rest.
    pub fn run_store(&self) -> Option<bool> {
        let store = Store::locate();
        let bun = crate::host::bun();
        let text = |e: pal_core::extensions::Error| e.to_string();
        let r: Result<bool, String> = match self {
            Cmd::Install { spec, from } => match (spec, from) {
                (_, Some(from)) => store.install_from(from, Some(&bun)),
                (Some(spec), None) => store.install(spec, Some(&bun)),
                (None, None) => unreachable!("clap requires one of them"),
            }
            .map_err(text)
            .map(|i| {
                println!("installed {} {} at {}", i.name, i.version, i.dir.display());
                true
            }),
            Cmd::Update { name: Some(name) } => store.update(name, Some(&bun)).map_err(text).map(|i| {
                println!("updated {} {}", i.name, i.version);
                true
            }),
            // Every extension with a source, each failure on its own line;
            // the exit status is 1 only when none could be updated.
            Cmd::Update { name: None } => store.list().map_err(text).and_then(|all| {
                let (mut changed, mut failed) = (false, Vec::new());
                for i in all.iter().filter(|i| i.record.is_some()) {
                    match store.update(&i.name, Some(&bun)) {
                        Ok(u) => {
                            println!("updated {} {}", u.name, u.version);
                            changed = true;
                        }
                        Err(e) => {
                            eprintln!("pal\t{}: {e}", i.name);
                            failed.push(i.name.clone());
                        }
                    }
                }
                if !changed && !failed.is_empty() {
                    return Err(format!("no extension updated ({})", failed.join(", ")));
                }
                Ok(changed)
            }),
            Cmd::Remove { name } => store.remove(name).map_err(text).map(|()| {
                println!("removed {name}");
                true
            }),
            Cmd::List => store.list().map_err(text).map(|all| {
                for i in &all {
                    let source = i.record.as_ref().map_or("(by hand)", |r| r.source.as_str());
                    println!("{}\t{}\t{}", i.name, i.version, source);
                }
                false
            }),
            _ => return None,
        };
        match r {
            Ok(changed) => Some(changed),
            Err(e) => {
                eprintln!("pal\t{e}");
                std::process::exit(1);
            }
        }
    }

    /// A second instance's argv. No subcommand there means show: what a
    /// second launch of a single-instance app conventionally does.
    pub fn from_args(args: Vec<String>) -> Option<Cmd> {
        match Cli::try_parse_from(args) {
            Ok(cli) => Some(cli.cmd.unwrap_or(Cmd::Show)),
            Err(e) => {
                eprintln!("cli\t{e}");
                None
            }
        }
    }

    /// Runs on the main thread: callers arrive from the plugin's socket
    /// task or the page-load hook. Fails only once the event loop is gone,
    /// when there is nothing left to show.
    pub fn run(self, app: &AppHandle) {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || match self {
            Cmd::Toggle => crate::toggle(&handle),
            Cmd::Show => crate::show(&handle),
            Cmd::Hide => crate::panel::hide(&handle),
            Cmd::Settings { page } => crate::settings::open_page(&handle, page.as_deref()),
            Cmd::Reload => {
                if let Some(host) = handle.try_state::<std::sync::Arc<crate::host::Host>>() {
                    let host = host.inner().clone();
                    tauri::async_runtime::spawn(async move { host.restart().await });
                }
            }
            Cmd::Quit => crate::quit(&handle),
            Cmd::Bar { cmd } => run_bar(&handle, cmd),
            Cmd::State { cmd: Some(StateCmd::Set { name, value, for_, until }) } => {
                let until = match (for_, until) {
                    (Some(d), _) => match crate::states::parse_duration(&d) {
                        Some(secs) => Some(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) + secs * 1000),
                        None => return eprintln!("states\tset {name}\tnot a duration: {d}"),
                    },
                    (None, Some(t)) => match crate::states::parse_until(&t) {
                        Some(u) => Some(u),
                        None => return eprintln!("states\tset {name}\tnot a time: {t}"),
                    },
                    (None, None) => None,
                };
                if let Err(e) = crate::states::set_manual(&handle, &name, state_value(&value), until) {
                    eprintln!("states\tset {name}\t{e}");
                }
            }
            Cmd::State { cmd: Some(StateCmd::Reset { name }) } => crate::states::reset(&handle, &name),
            Cmd::State { .. } => {}
            // Reaches the instance only when a second process skipped
            // `run_store` (it never does); the store is that process's job.
            Cmd::Install { .. } | Cmd::Update { .. } | Cmd::Remove { .. } | Cmd::List | Cmd::Action { .. } | Cmd::Instance { cmd: InstanceCmd::List } => {}
            // The instance's side of a picker: connect back to the CLI's socket (pick.rs). Without one the CLI process handled it.
            Cmd::Pick { reply: Some(socket), title, multi, query, select } => crate::pick::serve(&handle, socket.into(), crate::pick::Options { title, multi, query, select }),
            Cmd::Pick { reply: None, .. } => {}
            // A link twin: the instance runs the link it spells, trusted (module docs).
            ref cmd => {
                if let Some(link) = cmd.link() {
                    crate::deeplink::handle_trusted(&handle, &link);
                }
            }
        });
    }
}

/// `--anchor`: `sketchybar` queries the item's bounding rect (off the
/// main thread, it is a subprocess), `x,y,w,h` is a rect, anything else
/// (or nothing) no rect. Then the popover's event.
fn run_bar(app: &AppHandle, cmd: BarCmd) {
    use crate::bar::{popover, sketchybar, Rect};
    let anchor_of = |anchor: Option<&str>, key: &str| -> (Option<Rect>, &'static str) {
        match anchor {
            Some("sketchybar") => (sketchybar::anchor_of(&sketchybar::name_of(key)), "sketchybar"),
            Some("menubar") => (None, "menubar"),
            Some(s) => (Rect::parse(s), "cli"),
            None => (None, "cli"),
        }
    };
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || match cmd {
        BarCmd::Click { key, anchor } => {
            let (rect, name) = anchor_of(anchor.as_deref(), &key);
            popover::on_click(&app, &key, rect, name);
        }
        BarCmd::Hover { key, anchor, state } => {
            let entered = matches!(state.trim(), "enter" | "entered" | "mouse.entered");
            let (rect, name) = if entered { anchor_of(anchor.as_deref(), &key) } else { (None, "cli") };
            popover::on_hover(&app, &key, rect, entered, name);
        }
        BarCmd::Action { key, action } => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = crate::bar::action(&app, &key, &action, "cli", popover::WINDOW, None).await {
                    eprintln!("bar\taction\t{key}\t{action}\tfailed\t{e}");
                }
            });
        }
        BarCmd::Render { key } => crate::bar::render(&app, &key, "cli"),
        BarCmd::Sync => sketchybar::resync(&app),
        BarCmd::List | BarCmd::Json { .. } => {}
    });
}

/// Hands this process's argv to a running instance over the channel the
/// single-instance plugin listens on, before any of tauri is built: the
/// plugin would do the same from its setup, but only after GTK and the
/// display are up, 150 ms on marko against 40 for the bare binary. Same
/// wire format as tauri-plugin-single-instance 2.4.4 (its client side is
/// private; `platform_impl/{macos,linux}.rs` there is the reference:
/// macOS a unix socket `/tmp/<identifier with . and - as _>_si.sock`
/// carrying `<cwd>\0\0<argv joined by \0>`, Linux the session bus
/// `<identifier>.SingleInstance` `ExecuteCallback(argv, cwd)`; its
/// `semver` feature, which suffixes the name, must stay off). Checked
/// against that version's source 2026-09-16; a plugin bump is where this
/// breaks. False when no instance answered; the plugin then settles it.
pub fn handover(identifier: &str) -> bool {
    let args: Vec<String> = std::env::args().collect();
    handover_with(identifier, args)
}

/// Same channel, a different subcommand than this process was given
/// (`reload` after a store command). `argv[0]` stays ours.
pub fn handover_args(identifier: &str, args: &[&str]) -> bool {
    let mut argv = vec![std::env::args().next().unwrap_or_else(|| "pal".into())];
    argv.extend(args.iter().map(|a| a.to_string()));
    handover_with(identifier, argv)
}

fn handover_with(identifier: &str, args: Vec<String>) -> bool {
    let cwd = std::env::current_dir().unwrap_or_default().to_string_lossy().into_owned();
    send(identifier, &args, &cwd).is_ok()
}

#[cfg(target_os = "macos")]
fn send(identifier: &str, args: &[String], cwd: &str) -> std::io::Result<()> {
    use std::io::Write;
    let path = format!("/tmp/{}_si.sock", identifier.replace(['.', '-'], "_"));
    let mut s = std::os::unix::net::UnixStream::connect(path)?;
    write!(s, "{cwd}\0\0{}", args.join("\0"))
}

#[cfg(target_os = "linux")]
fn send(identifier: &str, args: &[String], cwd: &str) -> zbus::Result<()> {
    let name = format!("{identifier}.SingleInstance");
    let path = format!("/{}", name.replace('.', "/").replace('-', "_"));
    zbus::blocking::Connection::session()?.call_method(
        Some(name.as_str()),
        path.as_str(),
        Some("org.SingleInstance.DBus"),
        "ExecuteCallback",
        &(args, cwd),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::deeplink::{parse, Route};

    fn cmd(args: &[&str]) -> Cmd {
        let mut argv = vec!["pal"];
        argv.extend(args);
        Cli::try_parse_from(argv).unwrap_or_else(|e| panic!("{args:?}: {e}")).cmd.expect("a subcommand")
    }

    #[test]
    fn twins_spell_their_links_and_the_parser_reads_them_back() {
        let cases: &[(&[&str], &str)] = &[
            (&["open", "emoji/emoji", "-q", "two words!"], "pal://open/emoji/emoji?q=two%20words%21"),
            (&["open", "clipboard/history", "--filter", "links"], "pal://open/clipboard/history?filter=links"),
            (&["open", "--url", "https://a.b/c?d=1"], "pal://open?url=https%3A%2F%2Fa.b%2Fc%3Fd%3D1"),
            (&["run", "apps/apps/com.apple.Safari", "-a", "quit"], "pal://run/apps/apps/com.apple.Safari?action=quit"),
            (&["run", "a/b/with/slash", "--args", "{\"x\":1}"], "pal://run/a/b/with%2Fslash?args=%7B%22x%22%3A1%7D"),
            (&["form", "quicklinks/quicklinks/create", "-a", "create", "name=GitHub", "url=https://github.com"], "pal://form/quicklinks/quicklinks/create?action=create&name=GitHub&url=https%3A%2F%2Fgithub.com"),
            (&["copy", "hi there"], "pal://copy?text=hi%20there"),
            (&["paste", "x"], "pal://paste?text=x"),
            (&["hud", "Done"], "pal://hud?text=Done"),
            (&["toast", "Deployed", "v1.2"], "pal://toast?title=Deployed&message=v1.2"),
            (&["confetti"], "pal://confetti"),
            (&["confetti", "Shipped"], "pal://confetti?text=Shipped"),
            (&["command", "refresh"], "pal://commands/refresh"),
            (&["call", "timer/start", "duration=25m", "name=tea", "ring"], "pal://timer/start?duration=25m&name=tea&ring=1"),
            (&["link", "pal://toggle"], "pal://toggle"),
            (&["instance", "add", "gmail", "work", "--title", "Work", "--tint", "amber"], "pal://instance/add/gmail/work?title=Work&tint=amber"),
            (&["instance", "add", "github", "work"], "pal://instance/add/github/work"),
            (&["instance", "remove", "gmail@work"], "pal://instance/remove/gmail%40work"),
            (&["open", "gmail@work/inbox", "-q", "invoice"], "pal://open/gmail%40work/inbox?q=invoice"),
        ];
        for (args, link) in cases {
            let got = cmd(args).link().unwrap_or_else(|| panic!("{args:?} is no link twin"));
            assert_eq!(&got, link, "{args:?}");
            assert!(parse(&got).is_ok(), "{got}: the parser reads what the twin spells");
        }
        assert_eq!(parse(&cmd(&["run", "a/b/with/slash"]).link().unwrap()), Ok(Route::Run { source: pal_core::index::Source::new("a", "b"), id: "with/slash".into(), action: None, args: None, values: None, fill: None }), "a slash inside the id survives the round trip");
        assert!(cmd(&["toggle"]).link().is_none(), "the plain subcommands are not links");
        assert!(cmd(&["bar", "list"]).link().is_none());
        assert!(cmd(&["pick", "-m", "-t", "Branch"]).link().is_none());
    }

    #[test]
    fn instance_list_reads_the_file_and_the_twins_are_checked_first() {
        let (config, _) = pal_core::config::parse("[instances.\"gmail@work\"]\ntitle = \"Work\"\n[instances.\"gmail@old\"]\nenabled = false\n[instances.slack]\ntitle = \"Personal\"\n[instances.\"bad@@k\"]\n").unwrap();
        assert_eq!(instance_lines(&config), ["gmail\t\tdefault", "gmail@old\tOld\toff", "gmail@work\tWork\ton", "slack\tPersonal\tdefault"]);
        assert!(instance_lines(&pal_core::config::parse("").unwrap().0).is_empty());
        assert_eq!(cmd(&["instance", "add", "gmail", "default"]).run_compat(), Some(2), "the grammar refuses the suffix before anything is sent");
        assert_eq!(cmd(&["instance", "remove", "gmail"]).run_compat(), Some(2), "the default is not removed");
        assert_eq!(cmd(&["instance", "add", "gmail", "work"]).run_compat(), None, "a good one goes on to the handover");
        assert!(cmd(&["instance", "list"]).link().is_none(), "list is not a link");
    }

    #[test]
    fn pick_parses_its_flags_and_the_hidden_reply_socket() {
        assert_eq!(cmd(&["pick"]), Cmd::Pick { title: None, multi: false, query: None, select: None, reply: None });
        assert_eq!(cmd(&["pick", "--reply", "/tmp/x.sock", "--title", "T", "--multi", "--query", "q", "--select", "id"]), Cmd::Pick { title: Some("T".into()), multi: true, query: Some("q".into()), select: Some("id".into()), reply: Some("/tmp/x.sock".into()) });
    }

    #[test]
    fn a_link_the_grammar_refuses_never_leaves_this_process() {
        assert_eq!(cmd(&["link", "pal://nope"]).run_compat(), Some(2));
        assert_eq!(cmd(&["link", "toggle"]).run_compat(), Some(2), "no scheme");
        assert_eq!(cmd(&["link", "pal://toggle"]).run_compat(), None, "a good link goes on to the handover");
        assert_eq!(cmd(&["link", "--list"]).run_compat(), Some(0));
        assert!(Cli::try_parse_from(["pal", "link"]).is_err(), "a url or --list");
        assert!(Cli::try_parse_from(["pal", "open"]).is_err(), "a palette or --url");
    }
}

/// `2 h 40 m`, `12 m`, `40 s` for the table's time-left column.
fn left_text(secs: u64) -> String {
    match (secs / 3600, secs % 3600 / 60, secs % 60) {
        (0, 0, s) => format!("{s} s"),
        (0, m, _) => format!("{m} m"),
        (h, m, _) => format!("{h} h {m} m"),
    }
}
