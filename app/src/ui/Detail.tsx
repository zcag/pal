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
 * Side pane: a header when the detail has one (caption, title in the
 * design's display type, chips, large stats), then rendered markdown above a
 * metadata list. `loading`: the markdown is on its way (a lazy detail); a
 * skeleton stands in for it while the metadata, which is here already, shows
 * as it is.
 */
export function Detail({ detail, loading }: { detail: DetailSpec; loading?: boolean }) {
  const html = useMemo(() => (detail.markdown ? (md.parse(detail.markdown) as string) : ""), [detail.markdown]);
  return (
    <div className="pal-detail" aria-busy={loading || undefined}>
      {(detail.title || detail.caption || detail.chips?.length || detail.stats?.length) ? (
        <header className="pal-detail__head">
          {detail.caption && <div className="pal-detail__caption">{detail.caption}</div>}
          {detail.title && <h2 className="pal-detail__title">{detail.title}</h2>}
          {detail.chips?.length ? <div className="pal-detail__chips">{detail.chips.map((c, i) => <Tag key={i} text={c.text} color={c.color} />)}</div> : null}
          {detail.stats?.length ? (
            <dl className="pal-detail__stats">
              {detail.stats.map((s, i) => <div key={i} className="pal-detail__stat" data-color={s.color}><dd>{s.value}</dd><dt>{s.label}</dt></div>)}
            </dl>
          ) : null}
        </header>
      ) : null}
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
