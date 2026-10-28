export interface SplitPair {
  leftId: string;
  rightId: string;
  activeId: string;
  ratio: number;
}

export interface TabGroup {
  id: string;
  documentIds: string[];
  activeId: string;
  pair?: SplitPair;
}

export function pairFor(pairs: readonly SplitPair[], id: string): SplitPair | undefined {
  return pairs.find(pair => pair.leftId === id || pair.rightId === id);
}

export function createPair(documentIds: readonly string[], pairs: readonly SplitPair[], leftId: string, rightId: string): SplitPair {
  if (leftId === rightId) throw new Error('Choose a different file for the other side of the split.');
  if (!documentIds.includes(leftId) || !documentIds.includes(rightId)) throw new Error('One of these files is no longer open.');
  if (pairFor(pairs, leftId) || pairFor(pairs, rightId)) throw new Error('Unsplit these files before pairing them with another file.');
  return { leftId, rightId, activeId: leftId, ratio: 0.5 };
}

export function groupTabs(documentIds: readonly string[], pairs: readonly SplitPair[]): TabGroup[] {
  const groups: TabGroup[] = [];
  const visited = new Set<string>();
  for (const id of documentIds) {
    if (visited.has(id)) continue;
    const pair = pairFor(pairs, id);
    const ids = pair ? [pair.leftId, pair.rightId] : [id];
    for (const member of ids) visited.add(member);
    groups.push({ id: pair?.leftId ?? id, documentIds: ids, activeId: pair?.activeId ?? id, pair });
  }
  return groups;
}

export function splitRatio(value: number): number {
  if (!Number.isFinite(value)) throw new Error('The split divider position must be a finite number.');
  return Math.max(0.25, Math.min(0.75, value));
}

export const DEFAULT_SIDEBAR_WIDTH = 220;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 480;

export function sidebarWidth(value: number, windowWidth: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(windowWidth)) throw new Error('The sidebar width must be a finite number.');
  const maximum = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, windowWidth - 480));
  return Math.round(Math.max(MIN_SIDEBAR_WIDTH, Math.min(maximum, value)));
}
