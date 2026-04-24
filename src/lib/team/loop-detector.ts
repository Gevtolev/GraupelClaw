/**
 * True iff the `from → to` dispatch would form a recent loop.
 * Checks the last 3 entries of the activation chain for an adjacent
 * `to → from` pair — meaning we already saw `to` trigger `from`, and
 * now `from` wants to trigger `to` back.
 */
export function isRecentLoop(chain: string[], from: string, to: string): boolean {
  if (from === to) return false;
  const recent = chain.slice(-3);
  for (let i = 0; i < recent.length - 1; i++) {
    if (recent[i] === to && recent[i + 1] === from) return true;
  }
  return false;
}
