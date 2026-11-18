/**
 * Which bar items an embedded strip shows (docs/embed.md): a right-click on
 * the strip or its ⋯ opens this list under it; a flip hides or shows the
 * item at once and tells the host (`pal-bar-hide`), which keeps it for this
 * device on that site.
 */
const ROW = 30, PAD = 8, MAX = 360;

/** The card's height for `n` items. */
export const pickerHeight = (n: number) => Math.min(MAX, Math.max(1, n) * ROW + 2 * PAD);

type Props = { all: { key: string; title: string }[]; hidden: Set<string>; onFlip: (key: string) => void };

export function ItemPicker({ all, hidden, onFlip }: Props) {
  if (!all.length) return <p className="pal-embed-picker__none">No bar items yet.</p>;
  return (
    <ul className="pal-embed-picker" aria-label="Items shown here">
      {all.map((i) => (
        <li key={i.key}>
          <label className="pal-embed-picker__row" title={i.key}>
            <input type="checkbox" checked={!hidden.has(i.key)} onChange={() => onFlip(i.key)} />
            <span className="pal-embed-picker__title">{i.title || i.key}</span>
            <span className="pal-embed-picker__key">{i.key.split("/")[0]}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}
