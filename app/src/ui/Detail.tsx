import { useMemo } from "react";
import { Marked } from "marked";
import { Tag } from "./Row";
import type { Detail as DetailSpec, Metadata } from "./types";

// Raw HTML is dropped (extensions describe UI, never HTML); links open outside the panel.
const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: () => "",
    link({ href, text }) {
      return `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`;
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

/** Side pane: rendered markdown above a metadata list. */
export function Detail({ detail }: { detail: DetailSpec }) {
  const html = useMemo(() => (detail.markdown ? (md.parse(detail.markdown) as string) : ""), [detail.markdown]);
  return (
    <div className="pal-detail">
      {html && <div className="pal-detail__md pal-md" dangerouslySetInnerHTML={{ __html: html }} />}
      {detail.metadata?.length ? (
        <dl className="pal-detail__meta">
          {detail.metadata.map((m, i) => <Meta key={i} m={m} />)}
        </dl>
      ) : null}
    </div>
  );
}
