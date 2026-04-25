export interface DispatchEdge {
  from: string;
  to: string;
}

/**
 * True iff the proposed `from → to` dispatch would close a recent edge.
 *
 * Looks back over the last 3 dispatched edges for one whose direction is
 * the inverse — i.e. we already saw an edge `to → from`, and now `from`
 * wants to dispatch `to` again.
 *
 * NOTE: this is edge-based, not chain-based. A flat chain mistakenly
 * treats parallel fan-out targets (TL @-mentions four members in one
 * hop) as if they triggered each other, which produced false-positive
 * "loop" stops on the very next hop.
 */
export function isRecentLoop(
  edges: DispatchEdge[],
  from: string,
  to: string,
): boolean {
  if (from === to) return false;
  const recent = edges.slice(-3);
  return recent.some(e => e.from === to && e.to === from);
}
