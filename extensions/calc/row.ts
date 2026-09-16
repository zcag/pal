// What every parser answers: rows before they are Items. `name` is the
// result (the title, what Enter copies), `subtitle` what the query was
// understood as, `raw` the result without formatting.
import type { Accessory, Detail } from "@zcag/pal";

export type Row = {
  id: string;
  name: string;
  subtitle: string;
  raw?: string;
  accessories?: Accessory[];
  detail?: Detail;
  /** A message row: no actions. */
  inert?: boolean;
};
