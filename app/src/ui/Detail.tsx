import { useMemo } from "react";
import { Marked, Renderer, type Tokens } from "marked";
import { Tag } from "./Row";
import type { Detail as DetailSpec, Metadata } from "./types";

const unsafeScheme = /^\s*(javascript|data|vbscript):/i;

// Raw HTML is dropped (extensions describe UI, never HTML); links open outside the panel, script-ish ones become text.
const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: () => "",
    link(this: Renderer, token: Tokens.Link) {
      if (unsafeScheme.test(token.href)) return this.parser.parseInline(token.tokens);
      // The stock renderer escapes href and title; only the attributes are ours.
      return Renderer.prototype.link.call(this, token).replace(/^<a /, '<a target="_blank" rel="noreferrer" ');
    },
  },
});

function Meta({ m }: { m: Metadata }) {
  return (
    <div className="pal-meta">
      <dt className="pal-meta__label">{m.label}</dt>
      <dd className="pal-meta__value">
        {m.value}
        {m.link && <a href={m.link.href} target="_blank" rel="noreferrer">{m.link.text}</a>}
        {m.tags?.map((t, i) => <Tag key={i} text={t.text} color={t.color} />)}
      </dd>
    </div>
  );
}

/**
 * Side pane: rendered markdown above a metadata list. `loading`: the
 * markdown is on its way (a lazy detail); a skeleton stands in for it while
 * the metadata, which is here already, shows as it is.
 */
export function Detail({ detail, loading }: { detail: DetailSpec; loading?: boolean }) {
  const html = useMemo(() => (detail.markdown ? (md.parse(detail.markdown) as string) : ""), [detail.markdown]);
  return (
    <div className="pal-detail" aria-busy={loading || undefined}>
      {loading ? (
        <div className="pal-detail__md pal-detail__skeleton" role="status" aria-label="Loading details">
          <span style={{ width: "62%" }} /><span style={{ width: "88%" }} /><span style={{ width: "74%" }} /><span style={{ width: "40%" }} />
        </div>
      ) : html && <div className="pal-detail__md pal-md" dangerouslySetInnerHTML={{ __html: html }} />}
      {detail.metadata?.length ? (
        <dl className="pal-detail__meta">
          {detail.metadata.map((m, i) => <Meta key={i} m={m} />)}
        </dl>
      ) : null}
    </div>
  );
}
