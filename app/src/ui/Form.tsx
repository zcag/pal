import { useEffect, useRef, useState } from "react";
import { Kbd } from "./Kbd";
import { useKeys } from "./keys";
import type { FormField, FormValues } from "./types";

export type FormProps = {
  title?: string;
  fields: FormField[];
  submitTitle?: string;
  cancelTitle?: string;
  /** Messages by field id from whoever took the last submit; shown under the fields until the field changes. */
  errors?: Record<string, string>;
  /** Called with the values once every `required` field has one; never while one is empty. */
  onSubmit: (values: FormValues) => void;
  onCancel: () => void;
};

const initial = (fields: FormField[]): FormValues =>
  Object.fromEntries(fields.map((f) => [f.id, f.value ?? (f.kind === "checkbox" ? false : f.kind === "select" ? f.options[0]?.id ?? "" : "")]));

const empty = (v: string | boolean | undefined) => v === undefined || v === false || (typeof v === "string" && v.trim() === "");

/** The `required` fields without a value, by id, with the message shown under each. */
export const missing = (fields: FormField[], values: FormValues): Record<string, string> =>
  Object.fromEntries(fields.filter((f) => f.required && empty(values[f.id])).map((f) => [f.id, "Required"]));

/**
 * A prompt with fields. Enter submits from any field but a textarea, where
 * cmd+enter does; Escape cancels; Tab, arrows, Home/End and cmd+backspace
 * stay native inside the fields and never reach the launcher behind, nor do
 * cmd+1..9 and cmd+i, which would move or open things under the form. A
 * submit with a `required` field empty goes nowhere: the field is marked,
 * focused, and the mark clears as it is typed in. `errors` from outside
 * (the extension refusing a value) show the same way.
 */
export function Form({ title, fields, submitTitle = "Submit", cancelTitle = "Cancel", errors, onSubmit, onCancel }: FormProps) {
  const root = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState(() => initial(fields));
  /** Messages under fields: the last submit's misses, then whatever came back for it. A field's clears when it changes. */
  const [shown, setShown] = useState<Record<string, string>>({});
  useEffect(() => setShown(errors ?? {}), [errors]);
  const set = (id: string, v: string | boolean) => {
    setValues((s) => ({ ...s, [id]: v }));
    if (shown[id]) setShown(({ [id]: _, ...rest }) => rest);
  };
  const focusField = (id?: string) => {
    const el = id ? root.current?.elements.namedItem(id) : root.current?.querySelector("input, textarea, select");
    if (el instanceof HTMLElement) el.focus({ preventScroll: true });
  };
  const submit = () => {
    const miss = missing(fields, values);
    const first = Object.keys(miss)[0];
    if (first) { setShown(miss); focusField(first); return; }
    onSubmit(values);
  };

  useEffect(() => focusField(), []);
  // A message from outside lands on its field.
  useEffect(() => { const first = errors && Object.keys(errors)[0]; if (first) focusField(first); }, [errors]);
  const native = () => "native" as const;
  useKeys(
    {
      primary: () => (document.activeElement instanceof HTMLTextAreaElement ? native() : submit()),
      secondary: submit,
      escape: onCancel,
      move: native,
      jump: native,
      filter: native,
      back: native,
      jumpTo: () => {},
      detail: () => {},
      key: native,
    },
    { scope: root },
  );

  return (
    <form ref={root} className="pal-form" data-keyscope onSubmit={(e) => { e.preventDefault(); submit(); }} aria-labelledby={title ? "pal-form-title" : undefined} noValidate>
      {title && <h2 id="pal-form-title" className="pal-form__title">{title}</h2>}
      {fields.map((f) => {
        const error = shown[f.id];
        const describedBy = [error && `${f.id}-error`, f.description && `${f.id}-help`].filter(Boolean).join(" ") || undefined;
        const common = { name: f.id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy, "aria-required": f.required || undefined };
        return (
          <label key={f.id} className="pal-field" data-kind={f.kind} data-invalid={error ? "" : undefined}>
            <span className="pal-field__label">{f.label}{f.required && <span className="pal-field__required" aria-hidden> *</span>}</span>
            <span className="pal-field__body">
              {(f.kind === "text" || f.kind === "password") && <input {...common} className="pal-field__input" type={f.kind} placeholder={f.placeholder} value={values[f.id] as string} onChange={(e) => set(f.id, e.target.value)} spellCheck={false} autoComplete={f.kind === "password" ? "off" : undefined} />}
              {f.kind === "textarea" && <textarea {...common} className="pal-field__input" placeholder={f.placeholder} rows={4} value={values[f.id] as string} onChange={(e) => set(f.id, e.target.value)} />}
              {f.kind === "select" && (
                <select {...common} className="pal-field__input" value={values[f.id] as string} onChange={(e) => set(f.id, e.target.value)}>
                  {f.options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                </select>
              )}
              {f.kind === "checkbox" && (
                <span className="pal-field__check">
                  <input {...common} type="checkbox" checked={values[f.id] as boolean} onChange={(e) => set(f.id, e.target.checked)} />
                  {f.text && <span>{f.text}</span>}
                </span>
              )}
              {error && <span id={`${f.id}-error`} className="pal-field__error" role="alert">{error}</span>}
              {f.description && <span id={`${f.id}-help`} className="pal-field__help">{f.description}</span>}
            </span>
          </label>
        );
      })}
      <div className="pal-form__buttons">
        <button type="button" className="pal-button" onClick={onCancel}>{cancelTitle} <Kbd shortcut="escape" /></button>
        <button type="submit" className="pal-button" data-primary>{submitTitle} <Kbd shortcut="enter" /></button>
      </div>
    </form>
  );
}
