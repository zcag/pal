// The road's lanes, as the rules and the drawing both need them: +x is the driver's left.
export const LANE_W = 3.6;
export const SHOULDER = 2.6;

export type Layout = {
  lanes: number; // lanes our way
  oncoming: number; // lanes the other way (0 for one-way)
  median: number; // width between the two carriageways, m
};

export const ONE_WAY: Layout = { lanes: 4, oncoming: 0, median: 0 };
export const TWO_WAY: Layout = { lanes: 2, oncoming: 2, median: 0.4 };

/** Lane centres (+x is left). Lane 0 is our slow lane, on the right; with
 *  oncoming traffic, `oncomingX(0)` is their slow lane, on the far left. */
export function laneX(layout: Layout, lane: number) {
  const right = layout.oncoming ? -(layout.median / 2 + layout.lanes * LANE_W) : -(layout.lanes * LANE_W) / 2;
  return right + (lane + 0.5) * LANE_W;
}
export function oncomingX(layout: Layout, lane: number) {
  return layout.median / 2 + (layout.oncoming - 0.5 - lane) * LANE_W;
}

/** The asphalt's edges, + is left. */
export function edges(layout: Layout): [number, number] {
  if (!layout.oncoming) return [-(layout.lanes * LANE_W) / 2, (layout.lanes * LANE_W) / 2];
  return [-(layout.median / 2 + layout.lanes * LANE_W), layout.median / 2 + layout.oncoming * LANE_W];
}
