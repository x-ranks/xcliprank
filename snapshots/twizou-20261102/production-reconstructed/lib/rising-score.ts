export type RisingSignal = { id: string; opens: number; saves: number };

// A completed site save is weighted above an open, but an open is mandatory.
export function rankRising<T extends RisingSignal>(rows: T[], limit = 50): (T & { score: number })[] {
  return rows.filter(row => Number.isSafeInteger(row.opens) && row.opens > 0 && Number.isSafeInteger(row.saves) && row.saves >= 0)
    .map(row => ({ ...row, score: row.opens + row.saves * 2 }))
    .sort((a, b) => b.score - a.score || b.opens - a.opens || b.saves - a.saves || b.id.localeCompare(a.id))
    .slice(0, limit);
}
