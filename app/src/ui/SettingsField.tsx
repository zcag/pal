import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Kbd } from "./Kbd";
import { comboOf } from "./keys";
import { describeDefault, isModified, type SettingOption, type SettingSpec, type SettingValue } from "./SettingsTypes";

/* Controls. Each is a plain accessible widget sized by the tokens; the
   field renderer below picks one per declared setting kind. */

/** On/off. A button with role=switch: Space and Enter toggle. */
export function SettingsSwitch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="pal-switch" disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="pal-switch__knob" aria-hidden />
    </button>
  );
}

/**
 * Hotkey recorder. Shows the combo as key caps; Enter, Space or a click
 * starts recording, the next modifier combo is taken, Escape cancels,
 * Backspace while recording clears the hotkey.
 */
export function SettingsHotkey({ value, onChange, label, compact }: { value?: string; onChange: (v: string | undefined) => void; label?: string; compact?: boolean }) {
  const [recording, setRecording] = useState(false);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setRecording(true); }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return setRecording(false);
    if (e.key === "Backspace" || e.key === "Delete") { onChange(undefined); return setRecording(false); }
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    if (!(e.metaKey || e.ctrlKey || e.altKey)) return; // a global hotkey needs a modifier
    onChange(comboOf(e.nativeEvent));
    setRecording(false);
  };
  return (
    <button
      type="button"
      className="pal-hotkey"
      data-recording={recording || undefined}
      data-compact={compact || undefined}
      data-empty={!value && !recording ? "" : undefined}
      aria-label={label ? `${label}: ${value ?? "not set"}` : undefined}
      aria-live="polite"
      onClick={() => setRecording(true)}
      onKeyDown={onKey}
      onBlur={() => setRecording(false)}
    >
      {recording ? <span className="pal-hotkey__prompt">Press keys</span> : value ? <Kbd shortcut={value} /> : <span className="pal-hotkey__prompt">{compact ? "Record" : "Record hotkey"}</span>}
    </button>
  );
}

/** A few options, all visible. Arrow keys move between them. */
export function SettingsSegment({ value, options, onChange, label }: { value: string; options: SettingOption[]; onChange: (id: string) => void; label?: string }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    const i = options.findIndex((o) => o.id === value);
    const next = options[(i + dir + options.length) % options.length];
    onChange(next.id);
    (e.currentTarget.querySelector(`[data-id="${next.id}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div className="pal-segment" role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === value} data-id={o.id} tabIndex={o.id === value ? 0 : -1} className="pal-segment__item" onClick={() => onChange(o.id)}>
          {o.title}
        </button>
      ))}
    </div>
  );
}

export function SettingsSelect({ value, options, onChange, id, label }: { value: string; options: SettingOption[]; onChange: (id: string) => void; id?: string; label?: string }) {
  return (
    <span className="pal-select">
      <select id={id} aria-label={label} className="pal-select__input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
      </select>
      <span className="pal-select__chevron" aria-hidden>⌄</span>
    </span>
  );
}

/** Strings as chips; typing and Enter adds one, Backspace on an empty draft removes the last. */
function ListControl({ value, onChange, placeholder, id }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; id?: string }) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const commit = () => { const t = draft.trim(); if (t && !value.includes(t)) onChange([...value, t]); setDraft(""); };
  return (
    <div className="pal-chips" onClick={() => input.current?.focus()}>
      {value.map((v) => (
        <span key={v} className="pal-chips__chip">
          {v}
          <button type="button" className="pal-chips__remove" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>×</button>
        </span>
      ))}
      <input
        ref={input}
        id={id}
        className="pal-chips__input"
        value={draft}
        placeholder={value.length ? "Add…" : placeholder ?? "Add…"}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
          else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
      />
    </div>
  );
}

const isRef = (v: string) => /^(keychain|env):/.test(v);

/** A secret: the reference is shown, never the value. */
function SecretControl({ value, onChange, placeholder, id }: { value: string; onChange: (v: string) => void; placeholder?: string; id?: string }) {
  const [editing, setEditing] = useState(false);
  if (value && !editing) {
    const ref = isRef(value);
    return (
      <div className="pal-secret">
        <span className="pal-secret__box" title={ref ? "The file holds this reference; the value is in the OS keychain" : undefined}>
          <span className="pal-secret__mark" aria-hidden>●●●●</span>
          {ref ? <code className="pal-secret__ref">{value}</code> : <span className="pal-secret__plain">in the file as plain text</span>}
        </span>
        <button type="button" className="pal-setting__reset" onClick={() => setEditing(true)}>Replace…</button>
        <button type="button" className="pal-setting__reset" onClick={() => onChange("")}>Remove</button>
      </div>
    );
  }
  return (
    <input
      id={id}
      className="pal-field__input"
      type="password"
      autoComplete="off"
      placeholder={placeholder ?? "Paste the secret"}
      defaultValue=""
      autoFocus={editing}
      onBlur={(e) => { if (e.target.value) onChange(e.target.value); setEditing(false); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = ""; e.currentTarget.blur(); } }}
    />
  );
}

function Control({ spec, value, onChange, id }: { spec: SettingSpec; value: SettingValue; onChange: (v: SettingValue) => void; id: string }) {
  switch (spec.kind) {
    case "text":
      return <input id={id} className="pal-field__input" type="text" value={(value as string) ?? ""} placeholder={spec.placeholder} spellCheck={false} onChange={(e) => onChange(e.target.value)} />;
    case "secret":
      return <SecretControl id={id} value={(value as string) ?? ""} placeholder={spec.placeholder} onChange={onChange} />;
    case "number":
      return (
        <span className="pal-number">
          <input id={id} className="pal-field__input" type="number" value={value === undefined ? "" : (value as number)} min={spec.min} max={spec.max} step={spec.step} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
          {spec.unit && <span className="pal-number__unit">{spec.unit}</span>}
        </span>
      );
    case "boolean":
      return (
        <span className="pal-field__check">
          <SettingsSwitch checked={!!value} onChange={onChange} label={spec.label} />
          {spec.text && <span>{spec.text}</span>}
        </span>
      );
    case "select":
      return <SettingsSelect id={id} value={(value as string) ?? spec.options[0]?.id ?? ""} options={spec.options} onChange={onChange} />;
    case "hotkey":
      return <SettingsHotkey value={value as string | undefined} onChange={onChange} label={spec.label} />;
    case "path":
      return (
        <span className="pal-path">
          <input id={id} className="pal-field__input pal-path__input" type="text" value={(value as string) ?? ""} placeholder={spec.placeholder ?? (spec.pick === "folder" ? "Choose a folder" : "Choose a file")} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
          <button type="button" className="pal-button">Choose…</button>
        </span>
      );
    case "list":
      return <ListControl id={id} value={(value as string[]) ?? []} placeholder={spec.placeholder} onChange={onChange} />;
  }
}

export type SettingsFieldProps = {
  spec: SettingSpec;
  value: SettingValue;
  onChange: (value: SettingValue) => void;
  /** `row`: label in a column on the left (forms). `stack`: label above (narrow panes). */
  layout?: "row" | "stack";
};

/**
 * One declared setting as the right control, with label, description,
 * and, once the value differs from the declared default, the default and
 * a way back to it.
 */
export function SettingsField({ spec, value, onChange, layout = "row" }: SettingsFieldProps) {
  const id = useId();
  const modified = spec.default !== undefined && isModified(spec, value);
  const labelled = spec.kind !== "boolean" && spec.kind !== "hotkey" && spec.kind !== "secret";
  return (
    <div className="pal-setting" data-layout={layout} data-kind={spec.kind} data-modified={modified || undefined}>
      {labelled ? <label className="pal-setting__label" htmlFor={id}>{spec.label}</label> : <span className="pal-setting__label" id={`${id}-l`}>{spec.label}</span>}
      <div className="pal-setting__body">
        <div className="pal-setting__control">
          <Control spec={spec} value={value} onChange={onChange} id={id} />
          {modified && (
            <button type="button" className="pal-setting__reset" title={`Reset to default: ${describeDefault(spec)}`} onClick={() => onChange(spec.default)}>
              Reset
            </button>
          )}
        </div>
        {(spec.description || modified) && (
          <p className="pal-setting__desc">
            {spec.description}
            {modified && <span className="pal-setting__default">Default: {describeDefault(spec)}</span>}
          </p>
        )}
      </div>
    </div>
  );
}

/** A labelled row with any control, for pal's own settings (not declared ones). */
export function SettingsRow({ label, description, children, layout = "row", htmlFor }: { label: string; description?: ReactNode; children: ReactNode; layout?: "row" | "stack"; htmlFor?: string }) {
  return (
    <div className="pal-setting" data-layout={layout}>
      {htmlFor ? <label className="pal-setting__label" htmlFor={htmlFor}>{label}</label> : <span className="pal-setting__label">{label}</span>}
      <div className="pal-setting__body">
        <div className="pal-setting__control">{children}</div>
        {description && <p className="pal-setting__desc">{description}</p>}
      </div>
    </div>
  );
}

/** A section band over a group of rows, the same band the list uses. */
export function SettingsGroup({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="pal-settings-group" aria-label={title}>
      <h3 className="pal-settings-group__title">{title}{note && <span className="pal-settings-group__note">{note}</span>}</h3>
      {children}
    </section>
  );
}

/** The rule between what pal provides and what an extension declared. */
export function SettingsDivider({ text, note }: { text: string; note?: string }) {
  return (
    <div className="pal-settings-divider" role="separator" aria-label={text}>
      <span className="pal-settings-divider__text">{text}</span>
      {note && <span className="pal-settings-divider__note">{note}</span>}
    </div>
  );
}
