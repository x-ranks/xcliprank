export const X_PROMOTION_PLAN_STORAGE_KEY = "twizou_x_promotion_plans_v1";

export type PromotionPlan = {
  id: string;
  title: string;
  text: string;
  variant: "a" | "b" | "c";
  targetUrl: string;
  scheduledAt: string;
  createdAt: string;
  status: "planned" | "posted";
  postedUrl: string | null;
};

const isDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

export function readPromotionPlans(raw: string | null): PromotionPlan[] {
  if (!raw || raw.length > 100_000) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PromotionPlan => {
      if (!item || typeof item !== "object") return false;
      const row = item as Record<string, unknown>;
      return typeof row.id === "string" && row.id.length <= 80 &&
        typeof row.title === "string" && row.title.length <= 100 &&
        typeof row.text === "string" && row.text.length <= 280 &&
        ["a", "b", "c"].includes(String(row.variant)) &&
        typeof row.targetUrl === "string" && row.targetUrl.startsWith("https://twizou.net/") && row.targetUrl.length <= 500 &&
        isDate(row.scheduledAt) && isDate(row.createdAt) &&
        (row.status === "planned" || row.status === "posted") &&
        (row.postedUrl === null || typeof row.postedUrl === "string");
    }).slice(0, 100).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  } catch {
    return [];
  }
}

export function refreshPlanTarget(plan: PromotionPlan, currentUrl: string): string {
  if (!currentUrl.startsWith("https://twizou.net/")) return plan.text;
  return plan.targetUrl && plan.text.includes(plan.targetUrl)
    ? plan.text.replaceAll(plan.targetUrl, currentUrl)
    : plan.text;
}
