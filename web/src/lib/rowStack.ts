/**
 * One-dimensional overlap avoidance for the pinned row headers: each header wants its row's screen
 * y (centre); headers keep their order and are pushed apart until none overlap. Headers whose
 * resolved box leaves [top, bottom] are hidden rather than squeezed.
 */
export interface StackIn {
  id: string;
  y: number;
  h: number;
}

export interface StackOut {
  id: string;
  /** Top edge of the header box. */
  top: number;
  visible: boolean;
}

export function stackRows(rows: StackIn[], gap: number, top: number, bottom: number): StackOut[] {
  const sorted = [...rows].sort((a, b) => a.y - b.y);
  const tops = sorted.map((r) => r.y - r.h / 2);
  // push down, then pull back up from the bottom so a dense block stays centred on its rows
  for (let i = 1; i < sorted.length; i++) tops[i] = Math.max(tops[i], tops[i - 1] + sorted[i - 1].h + gap);
  for (let i = sorted.length - 2; i >= 0; i--) {
    const want = sorted[i].y - sorted[i].h / 2;
    if (tops[i] > want) tops[i] = Math.max(want, Math.min(tops[i], tops[i + 1] - sorted[i].h - gap));
  }
  const out = new Map<string, StackOut>();
  sorted.forEach((r, i) => out.set(r.id, { id: r.id, top: tops[i], visible: tops[i] >= top && tops[i] + r.h <= bottom }));
  return rows.map((r) => out.get(r.id)!);
}
