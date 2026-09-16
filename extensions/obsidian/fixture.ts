// Writes app/src/gallery/shots/obsidian.json: the store screenshots'
// fixture. A temp vault shaped like a real one (the `_index.md` /
// `_log.md` / `_rules.md` system files, infra, setup, personal/projects,
// preferences, work, a daily folder with its plugin config and template)
// is filled with invented notes, the extension runs over it through the
// host harness, and the rows, the pane, the search hits, the daily
// palette, the Append form and the page view come out of that run.
// Nothing here is the owner's. `bun run extensions/obsidian/fixture.ts`,
// then `node app/scripts/shots.mjs obsidian`.
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLED, Host, stored } from "../../host/test/harness.ts";
import manifest from "./pal.json" with { type: "json" };

const vault = mkdtempSync(join(tmpdir(), "vault-"));
const now = Date.now();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
/** Writes a note and dates it `hoursAgo` back, so the change dates on the rows spread out. */
const w = (p: string, t: string, hoursAgo = 0) => {
  mkdirSync(join(vault, p, ".."), { recursive: true });
  writeFileSync(join(vault, p), t);
  const at = new Date(now - hoursAgo * 3_600_000);
  utimesSync(join(vault, p), at, at);
};

w("_index.md", "# Wiki Index\n\nSummary and pointer layer for the vault.\n\n## System files\n- [[_rules]] routing, write-back rules, conventions\n- [[_log]] append-only activity log\n\n## Content\n- [[infra/theater]] the media box under the TV\n- [[infra/archer]] the always-on home server\n- [[setup/keyboard]] the layout and the layers\n- [[personal/projects/ken]] the feed reader\n- [[personal/projects/tan]] the standing agent\n", 30);
w("_log.md", `# Log\n\nAppend-only. One line per thing learned.\n\n- ${iso(day(1))}, infra / theater: the reader's port moved to 8791 after the Caddy rewrite\n- ${iso(day(3))}, ken: two digests a day was too many, back to one\n- ${iso(day(9))}, keyboard: home row mods on, tap-hold at 180 ms\n`, 20);
w("_rules.md", "# Rules\n\nRouting, conventions and write-back rules.\n\n## Principle\nWhen a file grows past ~50 lines, consider splitting it.\n\n## Conventions\n- File names: `kebab-case.md`\n- Each file: single `# Title` header, sections with `##`\n- Dates always as `YYYY-MM-DD`\n", 700);
w("infra/theater.md", "---\ndescription: The media box under the TV, and what runs on it\ntags: [infra, homelab]\naliases: [the box]\n---\n# theater\n\nA small box under the TV that runs the media stack and the reader. Caddy fronts everything on it, one hostname per service.\n\n> [!NOTE]\n> Every service is `<name>.lan`; Caddy reads the list from `sites.yml` and reloads on change.\n\n## Services\n\n| service | port | what |\n|---|---|---|\n| read | 8791 | the ebook reader, [[personal/projects/ken\\|ken]] feeds it |\n| photos | 2283 | the photo library |\n| bak | 8790 | the published-files viewer |\n\n## Gotchas\n\n- The disk spins down after 20 min; the first request after that takes 4 s.\n- A reboot needs the vault mounted first, see [[infra/archer]].\n\n```sh\nssh theater systemctl --user restart caddy\n```\n", 26);
w("infra/archer.md", "---\ndescription: The always-on home server, and the token broker on it\ntags: [infra, homelab]\n---\n# archer\n\nThe always-on box. Runs the token broker, the mail webhooks and the backup target for [[theater]].\n\n## Backups\n\n- Nightly at 03:00 to the second disk\n- Weekly to the cloud bucket, encrypted\n", 120);
w("setup/keyboard.md", "# keyboard\n\nThe layout and the layers. #setup #keyboard\n\n- Home row mods, tap-hold at 180 ms\n- Layer 1 on the right thumb: arrows and the number row\n- Layer 2: symbols\n\nThe firmware lives in the dotfiles, see [[setup/dotfiles]].\n", 200);
w("setup/dotfiles.md", "# dotfiles\n\nOne repo, stowed per machine. #setup\n\n```\nrobot dotty sync\n```\n", 300);
w("personal/projects/ken.md", "---\ndescription: The feed reader that sends one digest a day\ntags: [project, reading/rss]\n---\n# ken\n\nA feed reader. Pulls the feeds every hour, writes one digest a day, keeps read state itself so the mail is only a nudge.\n\n## Decisions\n\n1. One digest a day, not two: the second was never opened.\n2. Read state lives in ken, not in the mail client.\n3. Runs on [[theater]], next to the reader it feeds.\n\n- [ ] Archive view\n- [x] Mark all read\n", 5);
w("personal/projects/tan.md", "# tan\n\nThe standing agent. Runs every few hours and keeps one page of everything open. #project #agent\n\nReads [[ken]]'s digests and the mail; writes to its own space, never to this vault.\n", 2);
w("personal/trip-to-kas.md", "# Trip to Kaş\n\n#travel\n\n- Ferry times: 09:00 and 17:30\n- The cove past the harbour, go early\n- Book the [[personal/projects/tan|tan]] reminder for the return ferry\n", 50);
w("preferences/voice.md", "# voice\n\nHow I write. #preferences\n\n- Short. Plain. No padding.\n- Say what it is, then stop.\n", 400);
w("work/onboarding.md", "# onboarding\n\nFirst weeks at the new place. #work\n\n- [x] Laptop\n- [x] Accounts\n- [ ] The on-call rota, ask [[work/people/lina]]\n", 15);
w("work/people/lina.md", "# Lina\n\nTeam lead. Owns the on-call rota. #work #people\n", 60);
w(`daily/${iso(day(1))}.md`, `# ${iso(day(1))}\n\n## Log\n\n- Moved the reader's port, updated [[infra/theater]]\n- Read the ken digest\n`, 22);
w(`daily/${iso(day(2))}.md`, `# ${iso(day(2))}\n\n## Log\n\n- Ferry times for Kaş\n`, 46);
w(`daily/${iso(day(4))}.md`, `# ${iso(day(4))}\n\n## Log\n\n- Nothing much\n`, 94);
w(".obsidian/daily-notes.json", JSON.stringify({ folder: "daily", format: "YYYY-MM-DD", template: "templates/daily" }));
w("templates/daily.md", "# {{date:dddd, D MMMM YYYY}}\n\n## Log\n\n");

const icon = manifest.icon;
const clip = { id: 1, kind: "text", text: "The reader's first request after the disk spins down takes 4 s; worth a cache warm at 07:00.", image: null, files: null, source_app: null, at: now, bytes: 90, pinned: false, width: null, height: null };

stored.clear();
const host = await Host.bundled({ roots: [BUNDLED], settings: { obsidian: { settings: { vault, exclude: ["templates/**"] } } }, core: { "clipboard.current": () => clip }, timeout: 20000 });
try {
  const loaded = (await host.hello()).extensions.find((x) => x.name === "obsidian")!;
  const meta = (name: string) => loaded.palettes.find((p) => p.name === name)!;
  const notes = await host.list("obsidian", "notes");
  const daily = await host.list("obsidian", "daily");
  const recent = await host.list("obsidian", "recent");
  const tags = await host.list("obsidian", "tags");
  const searchEmpty = await host.list("obsidian", "search", "");
  const searchHits = await host.list("obsidian", "search", "caddy");
  const details: Record<string, unknown> = {};
  for (const r of [...notes, ...daily]) if (r.id.startsWith("note:") && !details[r.id]) details[r.id] = await host.detail("obsidian", "notes", r.id);
  const read = await host.pick("obsidian", "notes", "note:infra/theater.md", "read");
  const append = await host.pick("obsidian", "daily", "append");
  const newNote = await host.pick("obsidian", "notes", "cmd:new");

  const fixture = {
    palettes: {
      notes: { title: "Notes", icon, tier: "primary", placeholder: meta("notes").placeholder, items: notes, details },
      search: { title: "Search Notes", icon, input: true, placeholder: meta("search").placeholder, byQuery: { "": searchEmpty, caddy: searchHits } },
      daily: { title: "Daily Notes", icon, live: true, placeholder: meta("daily").placeholder, items: daily, details },
      tags: { title: "Tags", icon, tier: "catalog", placeholder: meta("tags").placeholder, items: tags },
      recent: { title: "Recent Notes", icon, live: true, placeholder: meta("recent").placeholder, items: recent, details },
    },
    effects: {
      "notes/note:infra/theater.md:read": read,
      "daily/append": append,
      "notes/cmd:new": newNote,
    },
    shots: {
      "1-notes": { palette: "notes", keys: ["down*11", "wait:300"] },
      "2-detail": { palette: "notes", keys: ["type:theater", "wait:300", "down", "cmd+i", "wait:500"] },
      "3-search": { palette: "search", keys: ["type:caddy", "wait:500", "cmd+i", "wait:400"] },
      "4-daily": { palette: "daily", keys: ["down", "wait:300"] },
      "5-append": { palette: "daily", keys: ["down*4", "enter", "wait:500"] },
      "6-read": { palette: "notes", keys: ["type:theater", "wait:300", "down", "cmd+shift+r", "wait:500"] },
    },
  };
  writeFileSync(new URL("../../app/src/gallery/shots/obsidian.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
  console.log(`${notes.length} note rows, ${daily.length} daily rows, ${tags.length} tags, ${searchHits.length} hits, view ${(read.view as { actions: unknown[] }).actions.length} actions`);
} finally {
  await host.close();
  rmSync(vault, { recursive: true, force: true });
}
