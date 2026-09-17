// sdk/src/md.ts on its own: the block parser, the inline reducer, the
// tree it draws, the outline and the plain text. No host, no server.
import { describe, expect, test } from "bun:test";
import { checkView } from "../../sdk/src/index.ts";
import { CALLOUT, MAX_CODE_LINES, MAX_TABLE_ROWS, excerpt, frontmatter, inline, outline, parseBlocks, plain, render } from "../../sdk/src/md.ts";
import type { ViewNode } from "../../sdk/src/protocol.ts";

const texts = (n: ViewNode): string[] => (n.type === "text" ? [n.value] : n.type === "stack" ? n.children.flatMap(texts) : n.type === "badge" ? [`[${n.text}]`] : []);
const find = (n: ViewNode, pred: (x: ViewNode) => boolean): ViewNode[] => [...(pred(n) ? [n] : []), ...(n.type === "stack" ? n.children.flatMap((c) => find(c, pred)) : [])];
const stacks = (n: ViewNode) => find(n, (x) => x.type === "stack") as Extract<ViewNode, { type: "stack" }>[];

describe("md", () => {
  test("front matter: keys as strings, the body after it; a body without one is untouched; a Slidev headmatter counts", () => {
    expect(frontmatter("---\ntitle: X\nsummary: \"y z\"\n---\n# A")).toEqual({ meta: { title: "X", summary: "y z" }, body: "# A" });
    expect(frontmatter("# A\n---\nnot front matter\n---")).toEqual({ meta: {}, body: "# A\n---\nnot front matter\n---" });
    expect(frontmatter("---\nlayout: cover\n---\n\n# Slide").body).toBe("\n# Slide");
  });

  test("inline: bold, italic, code and strike reduced; links, wikilinks (with a label), autolinks and images collected; a whole-run bold or code is said", () => {
    expect(inline("a **b** *c* `d` ~~e~~ f")).toEqual({ text: "a b c d e f", links: [], run: undefined });
    expect(inline("see [[Startup]] and [[Other|the other]] and [doc](https://x.y/z \"t\") and <https://a.b> and ![pic](https://i.m/g.png)")).toEqual({
      text: "see Startup and the other and doc and https://a.b and [image: pic]",
      links: [{ label: "Startup", page: "Startup" }, { label: "the other", page: "Other" }, { label: "doc", href: "https://x.y/z" }, { label: "pic", href: "https://i.m/g.png" }, { label: "https://a.b", href: "https://a.b" }],
      run: undefined,
    });
    expect(inline("**Just bold**")).toMatchObject({ text: "Just bold", run: "bold" });
    expect(inline("`code`")).toMatchObject({ text: "code", run: "code" });
    expect(inline("_soft_")).toMatchObject({ text: "soft", run: "italic" });
    expect(inline("snake_case_name and 2*3*4 stay")).toMatchObject({ text: "snake_case_name and 2*3*4 stay" });
    expect(inline("a<br>b <span class=\"x\">c</span> &amp; \\*not\\*")).toMatchObject({ text: "a\nb c & *not*" });
  });

  test("blocks: headings, paragraphs with soft and hard breaks, rules, fenced code with its language, a tilde fence", () => {
    const b = parseBlocks("# H1 #\n\n### H3\nline one\nline two  \nline three\n\n---\n\n```ts\nconst a = 1;\n```\n~~~\nplain\n~~~");
    expect(b).toEqual([
      { kind: "heading", level: 1, text: "H1", links: [] },
      { kind: "heading", level: 3, text: "H3", links: [] },
      { kind: "paragraph", text: "line one line two\nline three", links: [], run: undefined },
      { kind: "rule" },
      { kind: "code", lang: "ts", text: "const a = 1;" },
      { kind: "code", lang: "", text: "plain" },
    ]);
  });

  test("lists: bullets, an ordered list starting at 3, a marker change starts a new list, nesting by indent, tasks, a lazy continuation line", () => {
    const b = parseBlocks("- a\n- b [[P]]\n  - b1\n  - b2\n    - b2i\n- [ ] todo\n- [x] done\n  continued\n3. three\n4) four");
    expect(b).toHaveLength(2);
    const [ul, ol] = b as Extract<typeof b[number], { kind: "list" }>[];
    expect(ul.ordered).toBe(false);
    expect(ul.items.map((i) => i.text)).toEqual(["a", "b P", "todo", "done continued"]);
    expect(ul.items[1].links).toEqual([{ label: "P", page: "P" }]);
    expect(ul.items[1].children).toHaveLength(1);
    const nested = ul.items[1].children[0] as Extract<typeof b[number], { kind: "list" }>;
    expect(nested.items.map((i) => i.text)).toEqual(["b1", "b2"]);
    expect((nested.items[1].children[0] as Extract<typeof b[number], { kind: "list" }>).items[0].text).toBe("b2i");
    expect(ul.items[2]).toMatchObject({ task: true, done: false });
    expect(ul.items[3]).toMatchObject({ task: true, done: true });
    expect(ol).toMatchObject({ ordered: true, start: 3 });
    expect(ol.items.map((i) => i.text)).toEqual(["three", "four"]);
  });

  test("quotes and callouts: `> [!TIP] title` is a callout with its blocks, a plain quote a quote, a lazy line joins, `:::quote{cite}` carries the cite, other directives are unwrapped", () => {
    const b = parseBlocks("> [!TIP] Try it\n> first\nlazy\n> - a bullet\n\n> plain\n\n:::quote{cite=\"Ada\"}\nSaid.\n:::\n\n:::tabs\n### One\nx\n### Two\ny\n:::\n\n:::unknown\nkept\n:::");
    expect(b[0]).toMatchObject({ kind: "callout", type: "TIP", title: "Try it" });
    const callout = b[0] as Extract<typeof b[number], { kind: "callout" }>;
    expect(callout.blocks.map((x) => x.kind)).toEqual(["paragraph", "list"]);
    expect((callout.blocks[0] as { text: string }).text).toBe("first lazy");
    expect(b[1]).toMatchObject({ kind: "quote", blocks: [{ kind: "paragraph", text: "plain" }] });
    expect(b[2]).toMatchObject({ kind: "quote", cite: "Ada", blocks: [{ kind: "paragraph", text: "Said." }] });
    expect(b.slice(3).map((x) => x.kind)).toEqual(["heading", "paragraph", "heading", "paragraph", "paragraph"]);
    expect((b[7] as { text: string }).text).toBe("kept");
    expect(Object.keys(CALLOUT)).toEqual(["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]);
  });

  test("tables: header, alignment row, cells with escaped pipes and inline markup; details with a summary; an image line; html comments and bare tags dropped", () => {
    const b = parseBlocks("| a | **b** | c |\n|:--|:-:|--:|\n| 1 | x \\| y | `z` |\n\n<details><summary>More **stuff**</summary>\n\nhidden\n\n</details>\n\n![alt](https://x/y.png)\n<img src=\"https://x/z.png\" alt=\"zed\">\n<!-- note\nstill -->\n<div class=\"x\">\ntext\n</div>");
    expect(b[0]).toEqual({ kind: "table", header: ["a", "b", "c"], align: ["start", "center", "end"], rows: [["1", "x | y", "z"]] });
    expect(b[1]).toMatchObject({ kind: "details", summary: "More stuff", blocks: [{ kind: "paragraph", text: "hidden" }] });
    expect(b[2]).toEqual({ kind: "image", alt: "alt", src: "https://x/y.png" });
    expect(b[3]).toEqual({ kind: "image", alt: "zed", src: "https://x/z.png" });
    expect(b.slice(4)).toEqual([{ kind: "paragraph", text: "text", links: [], run: undefined }]);
  });

  test("render: a column stack the host accepts; headings sized by level, a callout on an elevated card with its badge, code and quotes on sunken wells, list marks, table columns with widths, links under their paragraph, an image as a line", () => {
    const md = "# One\n## Two\n### Three\n\nA [link](https://a.b) here.\n\n> [!WARNING]\n> careful\n\n- x\n- [x] y\n\n1. p\n2. q\n\n| k | v |\n|---|---|\n| a | 1 |\n\n```\ncode\n```\n\n> quoted\n\n![pic](https://i)\n\n**Bold para**\n\n`mono para`";
    const r = render(md);
    checkView({ tree: r.tree, actions: [] });
    expect(r.truncated).toBe(false);
    expect(r.links).toEqual([{ label: "link", href: "https://a.b" }]);
    const t = texts(r.tree);
    expect(t.slice(0, 4)).toEqual(["One", "Two", "Three", "A link here."]);
    expect(t).toContain("↗ link");
    expect(t).toEqual(expect.arrayContaining(["[Warning]", "careful", "•", "☑", "1.", "2.", "k", "v", "a", "1", "code", "quoted", "[image: pic]", "Bold para", "mono para"]));
    const heads = find(r.tree, (x) => x.type === "text" && ["One", "Two", "Three"].includes(x.value)) as { size?: string; style?: string }[];
    expect(heads.map((h) => [h.style, h.size])).toEqual([["title", "xl"], ["title", "lg"], ["body", "md"]]);
    expect(stacks(r.tree).filter((s) => s.surface === "elevated")).toHaveLength(1);
    expect(stacks(r.tree).filter((s) => s.surface === "sunken")).toHaveLength(2);
    const cols = find(r.tree, (x) => x.type === "text" && x.width !== undefined) as { value: string; width?: number; weight?: string }[];
    expect(cols.filter((c) => c.width! > 30).map((c) => c.value)).toEqual(["k", "v", "a", "1"]);
    expect(cols.find((c) => c.value === "k")!.weight).toBe("semibold");
    expect(find(r.tree, (x) => x.type === "text" && x.value === "Bold para")[0]).toMatchObject({ weight: "semibold" });
    expect(find(r.tree, (x) => x.type === "text" && x.value === "mono para")[0]).toMatchObject({ style: "mono" });
    expect(find(r.tree, (x) => x.type === "divider")).toHaveLength(1);
  });

  test("render: a diagram fence is a placeholder, a long code block and a long table are cut with a count, the node budget stops the tree with a line and says so", () => {
    const code = "```mermaid\ngraph TD\n```\n\n```\n" + Array.from({ length: MAX_CODE_LINES + 5 }, (_, i) => `l${i}`).join("\n") + "\n```\n\n| a |\n|---|\n" + Array.from({ length: MAX_TABLE_ROWS + 3 }, (_, i) => `| r${i} |`).join("\n");
    const t = texts(render(code).tree);
    expect(t[0]).toBe("[diagram: mermaid]");
    expect(t).toContain("… 5 more lines");
    expect(t).toContain("… 3 more rows");
    const big = render(Array.from({ length: 900 }, (_, i) => `para ${i}`).join("\n\n"), { maxNodes: 50 });
    expect(big.truncated).toBe(true);
    expect(texts(big.tree)).toHaveLength(51);
    expect(texts(big.tree).at(-1)).toBe("… the rest of the page is not shown");
    expect(texts(render("a\n\nb", { maxNodes: 1, where: "tela" }).tree).at(-1)).toBe("… the rest of the page is in tela");
    expect(texts(render("").tree)).toEqual(["Nothing on this page yet"]);
  });

  test("outline and plain: the headings with their level (inside callouts too); the plain text tela anchors on, blocks joined by newlines; the one-line excerpt", () => {
    const md = "---\nx: 1\n---\n# A\n\nSome **text** with [[L]].\n\n> [!NOTE]\n> ## Inside\n\n- one\n  - two\n\n| h |\n|---|\n| c |\n\n### B";
    expect(outline(md)).toEqual([{ level: 1, text: "A" }, { level: 2, text: "Inside" }, { level: 3, text: "B" }]);
    expect(plain(md)).toBe("A\nSome text with L.\nInside\none\ntwo\nh\nc\nB");
    expect(excerpt(md, 20)).toBe("A Some text with L.…");
  });
});
