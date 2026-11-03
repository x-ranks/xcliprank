export const INVENTORY_TIERS = ["S", "A+", "A", "B+", "B", "C", "D"] as const;
export type VideoInventory = { measuredAt: string; total: number; tiers: Record<string, number>; other: number };
export async function countVideoInventory(db: any): Promise<VideoInventory> {
  const query = () => db.from("posts").select("id", { count: "exact", head: true }).not("video_url", "is", null).neq("video_url", "");
  const count = async (q: any) => { const r = await q; if (r.error || !Number.isSafeInteger(r.count) || r.count < 0) throw Error("INVENTORY_UNAVAILABLE"); return r.count as number; };
  const total = await count(query()), tiers: Record<string, number> = {};
  // Three small count requests at a time; never transfer all post rows.
  for (let i = 0; i < INVENTORY_TIERS.length; i += 3) await Promise.all(INVENTORY_TIERS.slice(i, i + 3).map(async tier => {
    tiers[tier] = await count(query().or(`manual_tier.eq.${tier},and(manual_tier.is.null,adult_tier.eq.${tier})`));
  }));
  const sum = Object.values(tiers).reduce((a, b) => a + b, 0);
  if (sum > total) throw Error("INVENTORY_CHANGED_DURING_READ");
  return { measuredAt: new Date().toISOString(), total, tiers, other: total - sum };
}
