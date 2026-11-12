import { detectSurface } from "./engagement-surface";

export const VISIT_DAYS_KEY = "twizou_visit_days_v1";
export const INSTALL_DISMISSED_KEY = "twizou_install_dismissed_v1";
export const INSTALLED_KEY = "twizou_installed_v1";
/** After "later" the offer stays away for this long. */
export const DISMISS_MS = 14 * 24 * 3600 * 1000;
/** Pages where an offer is welcome; never on video pages, reels, or legal pages. */
export const OFFER_PATHS = new Set(["/", "/rising", "/ranking/daily", "/ranking/weekly", "/favorites", "/discover", "/browse"]);

export function japanDay(now: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

/** Keeps the last few distinct visit days (Japan time), newest last. */
export function addVisitDay(stored: unknown, now: number): string[] {
  const list = Array.isArray(stored) ? stored.filter((day): day is string => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)) : [];
  const today = japanDay(now);
  const next = list.includes(today) ? list : [...list, today];
  return next.slice(-5);
}

export type InstallMode = "prompt" | "ios" | "open-in-browser" | null;

export function installMode(input: { canPrompt: boolean; userAgent: string; standalone: boolean }): InstallMode {
  if (input.standalone) return null;
  if (input.canPrompt) return "prompt";
  const surface = detectSurface(false, input.userAgent);
  if (surface === "x-app" || surface === "other-app") return "open-in-browser";
  return /iPhone|iPad|iPod/.test(String(input.userAgent ?? "")) ? "ios" : null;
}

/** Offer only to a visitor who already came back on another day, has confirmed their age, and has not declined recently. */
export function shouldOfferInstall(input: {
  days: string[]; dismissedAt: unknown; installed: boolean; standalone: boolean; ageConfirmed: boolean; path: string; now: number;
}): boolean {
  if (input.standalone || input.installed || !input.ageConfirmed || !OFFER_PATHS.has(input.path)) return false;
  if (input.days.length < 2) return false;
  const dismissed = typeof input.dismissedAt === "number" && Number.isFinite(input.dismissedAt) ? input.dismissedAt : null;
  if (dismissed !== null && input.now >= dismissed && input.now - dismissed < DISMISS_MS) return false;
  return true;
}
