// Writes app/src/gallery/shots/tela.json and bar-tela.json: the store
// screenshots' fixture. The rows, the research view, the page view and the
// New page form come out of the real extension run through the host
// harness against the tests' mock instance (host/test/extensions/tela-mock.ts),
// with a few more pages added so the listings look lived in; nothing here
// is the owner's (the tests' "you" is renamed deniz). `make shots EXT=tela`.
import { BUNDLED, Host, stored } from "../../host/test/harness.ts";
import { BASE, FAVORITES, NOTIFICATIONS, PAGES, RECENT, SETTINGS, SPACES, server, setRead } from "../../host/test/extensions/tela-mock.ts";
import { pinClock, settle, writeFixture } from "../../app/scripts/fixture-kit.ts";
import manifest from "./pal.json" with { type: "json" };

pinClock();
for (const r of RECENT) if (r.author_username === "cagdas") r.author_username = "deniz";
for (const n of NOTIFICATIONS) if ("snippet" in n.data && n.data.snippet) n.data.snippet = n.data.snippet.replace("@cagdas", "@deniz");

// More of a wiki than the tests need: pages the recent list and the trees show.
Object.assign(PAGES, {
  14: { id: 14, space_id: 2, parent_id: null, title: "On-call runbook", body: "# On-call\n\n> [!IMPORTANT]\n> Page the owner before restarting the indexer.\n\n1. Check the queue\n2. Drain\n3. Restart", props: {}, created_at: "2026-09-05 10:00:00", updated_at: "2026-09-16 08:20:00" },
  15: { id: 15, space_id: 2, parent_id: 10, title: "Frecency", body: "# Frecency\n\nWhat the user picks climbs by up to a tier and a half.", props: {}, created_at: "2026-09-06 10:00:00", updated_at: "2026-09-15 16:00:00" },
  22: { id: 22, space_id: 1, parent_id: null, title: "Trip to Kaş", body: "- ferry times\n- the cove past the harbour", props: {}, created_at: "2026-09-08 10:00:00", updated_at: "2026-09-14 18:00:00" },
  31: { id: 31, space_id: 3, parent_id: null, title: "Why one index", body: "# Why one index\n\nOne box across everything.", props: {}, created_at: "2026-08-20 10:00:00", updated_at: "2026-09-11 09:00:00" },
});
SPACES.push({ id: 4, name: "Design", slug: "design", visibility: "private", description: "The brief, the tokens, the component set", is_personal: false, member_count: 3, created_at: "2026-04-01 10:00:00", updated_at: "2026-09-12 09:00:00" });
Object.assign(PAGES, { 40: { id: 40, space_id: 4, parent_id: null, title: "Brief", body: "# Brief\n\nHigh polish everywhere.", props: {}, created_at: "2026-09-01 10:00:00", updated_at: "2026-09-12 09:00:00" } });
RECENT.splice(1, 0, { page_id: 14, title: "On-call runbook", space_id: 2, space_name: "Engineering", author_username: "lina", updated_at: "2026-09-16 08:20:00" });
RECENT.splice(3, 0, { page_id: 15, title: "Frecency", space_id: 2, space_name: "Engineering", author_username: "mara", updated_at: "2026-09-15 16:00:00" });
RECENT.push({ page_id: 22, title: "Trip to Kaş", space_id: 1, space_name: "Notes", author_username: "deniz", updated_at: "2026-09-14 18:00:00" }, { page_id: 40, title: "Brief", space_id: 4, space_name: "Design", author_username: "ola", updated_at: "2026-09-12 09:00:00" }, { page_id: 31, title: "Why one index", space_id: 3, space_name: "Blog", author_username: "tomas", updated_at: "2026-09-11 09:00:00" });
FAVORITES.push({ page_id: 14, title: "On-call runbook", space_id: 2, space_name: "Engineering", created_at: "2026-09-07 10:00:00" });
setRead((n) => n.id === 901 || n.id === 902, false);

const icon = manifest.icon;

stored.clear();
delete process.env.PAL_TELA_URL;
delete process.env.PAL_TELA_TOKEN;
const host = await Host.bundled({ roots: [BUNDLED], settings: { tela: { settings: SETTINGS } }, timeout: 20000 });
try {
  const loaded = (await host.hello()).extensions.find((x) => x.name === "tela")!;
  const meta = (name: string) => loaded.palettes.find((p) => p.name === name)!;
  const pages = await host.list("tela", "pages");
  const spaces = await host.list("tela", "spaces");
  const searchEmpty = await host.list("tela", "search", "");
  const searchHits = await host.list("tela", "search", "index");
  const researchEmpty = await host.list("tela", "research", "");
  const researchRows = await host.list("tela", "research", "how does indexing work");
  const research = await host.pick("tela", "research", "ask:how does indexing work");
  const researchDown = await host.pick("tela", "research", "research", "down");
  const pageView = await host.pick("tela", "search", "page:10", "read");
  const newForm = await host.pick("tela", "pages", "cmd:new");
  // The harness has no clipboard; the shot shows what a copied passage looks like in the body.
  ((newForm.form as { fields: { default?: string }[] }).fields[2]).default = "What the user picks climbs by up to a tier and a half, so a much-used glyph passes the normal rows but never a primary one that has the word.\n\n- half-life 30 days\n- capped at 200";
  const decks = await host.list("tela", "decks");
  const comments = await host.list("tela", "comments");
  const details: Record<string, unknown> = {};
  for (const r of [...pages, ...searchHits]) if (r.id.startsWith("page:") && !details[r.id]) details[r.id] = await host.detail("tela", "pages", r.id);
  const bar = await host.render("tela", "inbox", { reason: "cli" });

  const fixture = {
    palettes: {
      search: { title: "Search tela", icon, input: true, placeholder: meta("search").placeholder, byQuery: { "": searchEmpty, index: searchHits }, details },
      research: { title: "Ask tela", icon, input: true, placeholder: meta("research").placeholder, byQuery: { "": researchEmpty, "how does indexing work": researchRows } },
      pages: { title: "Pages", icon, placeholder: meta("pages").placeholder, items: pages, details },
      spaces: { title: "Spaces", icon, placeholder: meta("spaces").placeholder, items: spaces },
      decks: { title: "Decks", icon, placeholder: meta("decks").placeholder, showDetail: true, items: decks, details: Object.fromEntries(await Promise.all(decks.map(async (d) => [d.id, await host.detail("tela", "decks", d.id)]))) },
      comments: { title: "Comments", icon, placeholder: meta("comments").placeholder, live: true, items: comments },
    },
    effects: {
      "research/ask:how does indexing work": research,
      "research/research:down": researchDown,
      "search/page:10:read": pageView,
      "pages/page:10:read": pageView,
      "pages/cmd:new": newForm,
    },
    shots: {
      "1-search": { palette: "search", keys: ["type:index", "wait:700", "down", "wait:300"], caption: "Search tela: ranked hits with the matching passage, sectioned by space" },
      "2-research": { palette: "research", keys: ["type:how does indexing work", "wait:400", "enter", "wait:500"], caption: "Ask tela: the sources of an answer as rows, the cited excerpt under the selected one, the flags above" },
      "3-page": { palette: "search", keys: ["type:index", "wait:700", "cmd+enter", "wait:500"], caption: "A page read in pal: headings, callouts, lists, code and tables drawn with the tokens" },
      "4-spaces": { palette: "spaces", keys: ["down", "wait:300"], caption: "Spaces with page counts; Enter lists a space's pages" },
      "5-new-page": { palette: "pages", keys: ["enter", "wait:400", "type:Frecency, explained", "wait:300"], caption: "New tela page: title, space, the body prefilled from the clipboard" },
      "6-pages": { palette: "pages", keys: ["down*5", "wait:300"], caption: "Pages: favourites, then what changed lately, sectioned by space" },
    },
  };
  const hosts = { [BASE]: "https://tela.example.com" };
  writeFixture("tela", await settle(fixture, { hosts }));

  const barFixture = {
    key: "tela/inbox",
    title: manifest.bar.inbox.title,
    item: bar,
    states: [{ id: "one", item: { badge: 1, tooltip: "1 mention" } }],
    shots: {
      "menubar": { target: "menubar", caption: "On the menu bar: the tela glyph with the count of unread mentions and replies" },
      "popover": { target: "menubar", popover: true, caption: "A click opens the popover: the newest mentions and replies, Open in pal, Mark all read" },
      "sketchybar": { target: "sketchybar", caption: "On sketchybar: the glyph and the count" },
    },
  };
  writeFixture("bar-tela", await settle(barFixture, { hosts }));
  console.log(`${pages.length} page rows, ${spaces.length} spaces, ${searchHits.length} hits, research ${(research.view as { actions: unknown[] }).actions.length} actions, bar badge ${bar.badge}`);
} finally {
  await host.close();
  server.stop(true);
}
