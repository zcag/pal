import { shortcutKeys } from "./format";
import type { Shortcut } from "./types";

/** A shortcut as key caps: ⌘ ⇧ C. */
export function Kbd({ shortcut }: { shortcut: Shortcut }) {
  return (
    <span className="pal-kbd" aria-label={shortcut}>
      {shortcutKeys(shortcut).map((k, i) => <kbd key={i}>{k}</kbd>)}
    </span>
  );
}
