import { useEffect, useRef } from "react";
import { Kbd } from "./Kbd";
import { keepFocus, useKeys } from "./keys";

export type ConfirmProps = {
  /** The question. */
  title: string;
  /** The go-ahead button's label: the action's own title. */
  action: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * A yes/no card over the list for an action that asks first. Enter goes
 * ahead, Escape backs out, Tab moves between the two buttons and nothing
 * else leaves the card: every other command is swallowed so the launcher
 * behind it cannot move or run anything while the question is up.
 */
export function Confirm({ title, action, destructive, onConfirm, onCancel }: ConfirmProps) {
  const root = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const go = useRef<HTMLButtonElement>(null);
  useEffect(() => go.current?.focus({ preventScroll: true }), []);
  const other = () => (document.activeElement === cancel.current ? go : cancel).current?.focus({ preventScroll: true });
  const swallow = () => {};
  useKeys(
    {
      primary: () => (document.activeElement === cancel.current ? onCancel() : onConfirm()),
      escape: onCancel,
      actions: onCancel,
      filter: other,
      move: ({ dir }) => (dir === "left" || dir === "right" ? other() : undefined),
      jump: swallow, jumpTo: swallow, secondary: swallow, back: swallow, detail: swallow, shortcut: swallow,
    },
    { scope: root },
  );
  return (
    <>
      <div className="pal-scrim" onClick={onCancel} aria-hidden />
      <div ref={root} className="pal-confirm" role="alertdialog" aria-modal aria-labelledby="pal-confirm-title" data-keyscope onMouseDown={keepFocus}>
        <div id="pal-confirm-title" className="pal-confirm__title">{title}</div>
        <div className="pal-form__buttons">
          <button ref={cancel} type="button" className="pal-button" onClick={onCancel}>Cancel <Kbd shortcut="escape" /></button>
          <button ref={go} type="button" className="pal-button" data-primary data-destructive={destructive || undefined} onClick={onConfirm}>{action} <Kbd shortcut="enter" /></button>
        </div>
      </div>
    </>
  );
}
