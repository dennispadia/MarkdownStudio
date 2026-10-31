export type ScrollAnchor = { source: number; visual: number };

export function scrollPosition(position: number, anchors: readonly ScrollAnchor[], from: 'source' | 'visual'): number {
  if (!Number.isFinite(position) || anchors.length < 2) throw new Error('Scroll mapping requires a finite position and at least two anchors.');
  const to = from === 'source' ? 'visual' : 'source';
  const first = anchors[0];
  const last = anchors.at(-1)!;
  if (position <= first[from]) return first[to];
  if (position >= last[from]) return last[to];
  for (let index = 1; index < anchors.length; index++) {
    const before = anchors[index - 1]; const after = anchors[index];
    if (after[from] <= before[from]) throw new Error('Scroll anchors must be strictly increasing in both views.');
    if (position <= after[from]) return before[to] + (position - before[from]) / (after[from] - before[from]) * (after[to] - before[to]);
  }
  return last[to];
}

export function scrollAnchors(points: readonly ScrollAnchor[], sourceMax: number, visualMax: number): ScrollAnchor[] {
  if (![sourceMax, visualMax, ...points.flatMap(point => [point.source, point.visual])].every(Number.isFinite)) throw new Error('Scroll anchors must be finite.');
  const result = [{ source: 0, visual: 0 }];
  for (const point of [...points].sort((a, b) => a.source - b.source)) {
    const before = result.at(-1)!;
    if (point.source > before.source && point.visual > before.visual && point.source < sourceMax && point.visual < visualMax) result.push(point);
  }
  result.push({ source: Math.max(1, sourceMax), visual: Math.max(1, visualMax) });
  return result;
}
