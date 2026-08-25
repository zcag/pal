import { Detail, List } from "@raycast/api";
import { Fragment } from "react";
import type { MetadataEntry } from "../lib/pal";
import { iconFor, toColor } from "../lib/icon";

/**
 * pal's `detail.metadata` is a flat list of labelled fields; Raycast wants
 * discrete Label/Link/TagList/Separator children. Both List.Item.Detail and
 * Detail share the same Metadata children, so this renders for either.
 */
export function Metadata({ entries }: { entries: MetadataEntry[] }) {
  const M = Detail.Metadata as unknown as typeof List.Item.Detail.Metadata;

  return (
    <>
      {entries.map((entry, index) => {
        const key = `${entry.label ?? "entry"}-${index}`;

        if (entry.separator) {
          return <M.Separator key={key} />;
        }

        if (entry.tags?.length) {
          return (
            <M.TagList key={key} title={entry.label ?? ""}>
              {entry.tags.map((tag, tagIndex) => {
                const text = typeof tag === "string" ? tag : (tag.text ?? "");
                const color = typeof tag === "string" ? undefined : toColor(tag.color);
                return (
                  <M.TagList.Item
                    key={`${key}-${tagIndex}`}
                    text={text}
                    color={color}
                  />
                );
              })}
            </M.TagList>
          );
        }

        if (entry.link) {
          return (
            <M.Link
              key={key}
              title={entry.label ?? ""}
              target={entry.link}
              text={entry.text ?? entry.link}
            />
          );
        }

        return (
          <M.Label
            key={key}
            title={entry.label ?? ""}
            text={entry.text ?? ""}
            icon={entry.icon ? iconFor({ icon: entry.icon, color: entry.color }) : undefined}
          />
        );
      })}
    </>
  );
}

/** Metadata wrapped for a List.Item.Detail, or undefined when there's none. */
export function listMetadata(entries?: MetadataEntry[]) {
  if (!entries?.length) return undefined;
  return (
    <List.Item.Detail.Metadata>
      <Metadata entries={entries} />
    </List.Item.Detail.Metadata>
  );
}

export { Fragment };
