import { useEffect, useRef, useState } from "react";
import { Kbd } from "./Kbd";
import { useKeys } from "./keys";
import type { FormField, FormValues } from "./types";

export type FormProps = {
  title?: string;
  fields: FormField[];
  submitTitle?: string;
  onSubmit: (values: FormValues) => void;
  onCancel: () => void;
};

const initial = (fields: FormField[]): FormValues =>
  Object.fromEntries(fields.map((f) => [f.id, f.value ?? (f.kind === "checkbox" ? false : f.kind === "select" ? f.options[0]?.id ?? "" : "")]));

/**
 * A prompt with fields. Enter submits from any field but a textarea, where
 * cmd+enter does; Escape cancels; Tab, arrows, Home/End and cmd+backspace
 * stay native inside the fields and never reach the launcher behind.
 */
export function Form({ title, fields, submitTitle = "Submit", onSubmit, onCancel }: FormProps) {
  const root = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState(() => initial(fields));
  const set = (id: string, v: string | boolean) => setValues((s) => ({ ...s, [id]: v }));
  const submit = () => onSubmit(values);

  useEffect(() => root.current?.querySelector<HTMLElement>("input, textarea, select")?.focus({ preventScroll: true }), []);
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
    },
    { scope: root },
  );

  return (
    <form ref={root} className="pal-form" data-keyscope onSubmit={(e) => { e.preventDefault(); submit(); }} aria-label={title}>
      {title && <h2 className="pal-form__title">{title}</h2>}
      {fields.map((f) => (
        <label key={f.id} className="pal-field" data-kind={f.kind}>
          <span className="pal-field__label">{f.label}</span>
          {f.kind === "text" && <input className="pal-field__input" type="text" placeholder={f.placeholder} value={values[f.id] as string} onChange={(e) => set(f.id, e.target.value)} spellCheck={false} />}
          {f.kind === "textarea" && <textarea className="pal-field__input" placeholder={f.placeholder} rows={4} value={values[f.id] as string} onChange={(e) => set(f.id, e.target.value)} />}
          {f.kind === "select" && (
            <select className="pal-field__input" value={values[f.id] as string} onChange={(e) => set(f.id, e.target.value)}>
              {f.options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
            </select>
          )}
          {f.kind === "checkbox" && (
            <span className="pal-field__check">
              <input type="checkbox" checked={values[f.id] as boolean} onChange={(e) => set(f.id, e.target.checked)} />
              {f.text && <span>{f.text}</span>}
            </span>
          )}
        </label>
      ))}
      <div className="pal-form__buttons">
        <button type="button" className="pal-button" onClick={onCancel}>Cancel <Kbd shortcut="escape" /></button>
        <button type="submit" className="pal-button" data-primary>{submitTitle} <Kbd shortcut="enter" /></button>
      </div>
    </form>
  );
}
