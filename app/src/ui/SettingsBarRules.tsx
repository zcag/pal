// Settings > Bar > an item's Rules (docs/design/states.md, "Rules"): the
// extension's presentation rules with the file's overrides on top, and
// the user's own, each a row that says what it reads, what it does and
// whether it holds now. A row opens into an editor of the few keys a
// rule is made of (when, hidden, urgent, tint, size, position, icon);
// every edit is one key under `[bar.items."<key>".rules.<id>]`, Reset
// drops the table so the extension's rule applies again, Remove drops a
// rule of the user's own. Above the list, the facts the item publishes
// with their live values: what the expressions read.
import { useState } from "react";
import { SettingsSelect } from "./SettingsField";
import type { BarItem, BarRuleEffect, BarRuleView } from "./SettingsTypes";

/** What changes on one rule: `null` drops the whole table (reset, or remove for the user's own); a key set to `undefined` unsets that key. */
export type RuleWrite = Partial<Record<"when" | "description", string | undefined>> & Partial<Record<keyof BarRuleEffect, unknown>>;

export type RulesProps = {
  b: BarItem;
  anchor: string;
  /** `null` resets (or removes) the rule; else the keys to write under its table. */
  onRule: (id: string, write: RuleWrite | null) => void;
};

const tri = [{ id: "", title: "Leave" }, { id: "on", title: "Yes" }, { id: "off", title: "No" }];
const triValue = (v: boolean | undefined) => (v === undefined ? "" : v ? "on" : "off");
const triParse = (s: string) => (s === "" ? undefined : s === "on");

/** The effect as short words: what the rule does while it holds. */
export function effectChips(e: BarRuleEffect): string[] {
  const out: string[] = [];
  if (e.hidden === true) out.push("hidden");
  if (e.hidden === false) out.push("shown");
  if (e.urgent === true) out.push("urgent");
  if (e.urgent === false) out.push("calm");
  if (e.color) out.push(`tint ${e.color}`);
  if (e.size) out.push(`${e.size} pt`);
  if (e.position) out.push(`at ${e.position}`);
  if (e.icon) out.push(`icon ${e.icon}`);
  if (e.showTitle === false) out.push("no title");
  if (e.showIcon === false) out.push("no icon");
  if (e.dim !== undefined) out.push(`dim ${e.dim}%`);
  if (e.font) out.push(e.font);
  if (e.width) out.push(`${e.width} pt wide`);
  return out;
}

const fact = (v: unknown) => (v === null ? "unknown" : typeof v === "string" ? `"${v}"` : String(v));

export function SettingsBarRules({ b, anchor, onRule }: RulesProps) {
  const rules = b.rules ?? [];
  const facts = b.states ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ id: "", when: "" });
  const draftOk = /^[a-z0-9_]+$/.test(draft.id) && !rules.some((r) => r.id === draft.id) && draft.when.trim() !== "";
  const add = () => {
    if (!draftOk) return;
    onRule(draft.id, { when: draft.when.trim(), hidden: true });
    setDraft({ id: "", when: "" });
    setAdding(false);
    setOpen(draft.id);
  };
  return (
    <section className="pal-ppane__section pal-rules" aria-label="Rules" data-anchor={`${anchor}:rules`}>
      <h4 className="pal-ppane__h">Rules <span className="pal-ppane__h-note">bar.items."{b.key}".rules, in order, later wins</span></h4>
      <p className="pal-rules__lead">While a rule's condition holds, the item is hidden, urgent, or drawn its way. The extension's rules are the defaults: change any key of one, or add your own. A condition is a state expression over the facts below and any state (<code>working</code>, <code>hour</code>), with <code>and</code>, <code>or</code>, <code>not</code>.</p>
      {facts.length > 0 && (
        <p className="pal-rules__facts" data-testid="rule-facts">
          <span className="pal-rules__facts-label">Reads</span>
          {facts.map((f) => (
            <span key={f.name} className="pal-rules__fact" title={f.description}>
              <code>{b.extension}.{f.name}</code> <span className="pal-rules__fact-value">{fact(f.value)}</span>
            </span>
          ))}
        </p>
      )}
      {rules.length === 0 && !adding && <p className="pal-ppane__none">No rules: the item draws as the extension renders it.</p>}
      <ol className="pal-rules__list">
        {rules.map((r) => (
          <RuleRow key={r.id} r={r} extTitle={b.extTitle} anchor={anchor} open={open === r.id} onOpen={() => setOpen(open === r.id ? null : r.id)} onWrite={(w) => onRule(r.id, w)} />
        ))}
      </ol>
      {adding ? (
        <div className="pal-rules__add" data-testid="rule-add">
          <input className="pal-field__input pal-rules__id" type="text" placeholder="id, e.g. focus" value={draft.id} spellCheck={false} aria-label="New rule id" aria-invalid={draft.id !== "" && !/^[a-z0-9_]+$/.test(draft.id) ? true : undefined} onChange={(e) => setDraft({ ...draft, id: e.target.value.trim() })} onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") setAdding(false); }} />
          <input className="pal-field__input pal-rules__when" type="text" placeholder="when, e.g. not working" value={draft.when} spellCheck={false} aria-label="New rule condition" onChange={(e) => setDraft({ ...draft, when: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") setAdding(false); }} />
          <button type="button" className="pal-button" data-small disabled={!draftOk} onClick={add}>Add</button>
          <button type="button" className="pal-button" data-small data-quiet onClick={() => setAdding(false)}>Cancel</button>
          <span className="pal-rules__add-note">Starts as hidden while the condition holds; open it to change what it does.</span>
        </div>
      ) : (
        <button type="button" className="pal-button" data-small onClick={() => setAdding(true)}>Add a rule</button>
      )}
    </section>
  );
}

function RuleRow({ r, extTitle, anchor, open, onOpen, onWrite }: { r: BarRuleView; extTitle: string; anchor: string; open: boolean; onOpen: () => void; onWrite: (w: RuleWrite | null) => void }) {
  const own = !r.default;
  const chips = effectChips(r.effect);
  const id = `${anchor}-rule-${r.id}`;
  const [when, setWhen] = useState(r.when);
  const commitWhen = () => { if (when.trim() !== r.when) onWrite({ when: when.trim() || undefined }); };
  return (
    <li className="pal-rules__row" data-active={r.active || undefined} data-overridden={r.overridden || undefined} data-own={own || undefined} data-open={open || undefined} data-testid={`rule-${r.id}`}>
      <button type="button" className="pal-rules__head" aria-expanded={open} aria-controls={`${id}-editor`} onClick={onOpen}>
        <span className="pal-rules__dot" title={r.active ? "Holds now" : "Does not hold now"} aria-label={r.active ? "holds now" : "does not hold"} />
        <span className="pal-rules__name">{r.id}</span>
        <code className="pal-rules__cond">{r.when || "(no condition)"}</code>
        <span className="pal-rules__effect">{chips.length ? chips.map((c) => <span key={c} className="pal-rules__chip">{c}</span>) : <span className="pal-rules__chip" data-empty>does nothing</span>}</span>
        <span className="pal-rules__origin">{own ? "yours" : r.overridden ? `from ${extTitle}, changed` : `from ${extTitle}`}</span>
      </button>
      {open && (
        <div className="pal-rules__editor" id={`${id}-editor`}>
          {r.description && <p className="pal-rules__desc">{r.description}</p>}
          <div className="pal-rules__fields">
            <label className="pal-rules__field pal-rules__field--wide">
              <span className="pal-rules__label">When</span>
              <input className="pal-field__input pal-rules__when" type="text" value={when} spellCheck={false} aria-label={`${r.id} condition`} onChange={(e) => setWhen(e.target.value)} onBlur={commitWhen} onKeyDown={(e) => { if (e.key === "Enter") { commitWhen(); e.currentTarget.blur(); } if (e.key === "Escape") { setWhen(r.when); e.currentTarget.blur(); } }} />
              {r.default?.when !== undefined && r.default.when !== r.when && <span className="pal-rules__default">{extTitle} has <code>{r.default.when}</code></span>}
            </label>
            <label className="pal-rules__field">
              <span className="pal-rules__label">Hidden</span>
              <SettingsSelect id={`${id}-hidden`} value={triValue(r.effect.hidden)} options={tri} onChange={(v) => onWrite({ hidden: triParse(v) })} />
            </label>
            <label className="pal-rules__field">
              <span className="pal-rules__label">Urgent</span>
              <SettingsSelect id={`${id}-urgent`} value={triValue(r.effect.urgent)} options={tri} onChange={(v) => onWrite({ urgent: triParse(v) })} />
            </label>
            <label className="pal-rules__field">
              <span className="pal-rules__label">Tint</span>
              <input className="pal-field__input" type="text" list="pal-bar-colors" placeholder="leave" value={r.effect.color ?? ""} spellCheck={false} aria-label={`${r.id} tint`} onChange={(e) => onWrite({ color: e.target.value || undefined })} />
            </label>
            <label className="pal-rules__field">
              <span className="pal-rules__label">Size</span>
              <span className="pal-number"><input className="pal-field__input" type="number" min={0} max={24} step={0.5} placeholder="leave" value={r.effect.size ?? ""} aria-label={`${r.id} size`} onChange={(e) => onWrite({ size: e.target.value === "" ? undefined : Number(e.target.value) })} /><span className="pal-number__unit">pt</span></span>
            </label>
            <label className="pal-rules__field">
              <span className="pal-rules__label">Position</span>
              <input className="pal-field__input pal-bar__position" type="text" placeholder="leave" value={r.effect.position ?? ""} spellCheck={false} aria-label={`${r.id} position`} onChange={(e) => onWrite({ position: e.target.value || undefined })} />
            </label>
            <label className="pal-rules__field">
              <span className="pal-rules__label">Icon</span>
              <input className="pal-field__input pal-bar-field__text" type="text" placeholder="leave" value={r.effect.icon ?? ""} spellCheck={false} aria-label={`${r.id} icon`} onChange={(e) => onWrite({ icon: e.target.value || undefined })} />
            </label>
          </div>
          <div className="pal-rules__actions">
            {own ? (
              <button type="button" className="pal-button" data-small data-destructive onClick={() => onWrite(null)}>Remove rule</button>
            ) : (
              <button type="button" className="pal-button" data-small disabled={!r.overridden} onClick={() => onWrite(null)}>Reset to the extension's</button>
            )}
            <span className="pal-pane__note">Leave keeps what the render says. The other appearance keys (dim, font, width, badge) take the file: <code>[bar.items."{"…"}".rules.{r.id}]</code>.</span>
          </div>
        </div>
      )}
    </li>
  );
}
