import type { HTMLAttributes, Ref } from "react";
import { shortcutKeys } from "./format";
import type { Shortcut } from "./types";

/** A shortcut as key caps: ⌘ ⇧ C. Other attributes (a `ref` among them) land on the span. */
export function Kbd({ shortcut, className, ...rest }: { shortcut: Shortcut; ref?: Ref<HTMLSpanElement> } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={className ? `pal-kbd ${className}` : "pal-kbd"} aria-label={shortcut} {...rest}>
      {shortcutKeys(shortcut).map((k, i) => <kbd key={i}>{k}</kbd>)}
    </span>
  );
}
