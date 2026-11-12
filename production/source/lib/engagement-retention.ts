import { SURFACES } from "./engagement-surface";

export type RetentionRow = {
  occurred_at: string;
  event_type: string;
  anonymous_id_hash: string;
  session_id: string;
  metadata: Record<string, unknown> | null;
};

export type ReturnGroup = { users: number; returningUsers: number };
export type Retention = {
  returnByAcquisition: Record<string, ReturnGroup>;
  returnBySurface: Record<string, ReturnGroup>;
  bounce: { sessions: number; bounceSessions: number; bounceRate: number };
};

export function textMetadata(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function acquisitionOf(row: { metadata: Record<string, unknown> | null }) {
  const utmSource = textMetadata(row.metadata, "utmSource");
  const referrerHost = textMetadata(row.metadata, "referrerHost");
  if (
    utmSource === "x" || utmSource === "twitter" ||
    referrerHost === "x.com" || referrerHost.endsWith(".x.com") ||
    referrerHost === "twitter.com" || referrerHost.endsWith(".twitter.com") || referrerHost === "t.co"
  ) return "x";
  if (utmSource) return `campaign:${utmSource}`;
  if (referrerHost) return `referral:${referrerHost}`;
  return "direct";
}

const day = (value: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date(value));

/** Return rate per first visit source and per display surface, plus how many visits end without any video opened.
 *  A returning user is a device seen on two or more Japan-time days. Rows must be sorted oldest first. */
export function summarizeRetention(rows: RetentionRow[]): Retention {
  const days = new Map<string, Set<string>>();
  const firstAcquisition = new Map<string, string>();
  const surface = new Map<string, string>();
  const sessions = new Map<string, { views: number; opens: number }>();
  for (const row of rows) {
    const user = row.anonymous_id_hash;
    (days.get(user) ?? days.set(user, new Set()).get(user)!).add(day(row.occurred_at));
    // First source that is not "direct": the first event of a later tab is often a plain navigation.
    const acquisition = acquisitionOf(row);
    const known = firstAcquisition.get(user);
    if (!known || (known === "direct" && acquisition !== "direct")) firstAcquisition.set(user, acquisition);
    // "installed" wins; otherwise the first surface that was recorded (older events carry none).
    const seen = textMetadata(row.metadata, "surface");
    const next = (SURFACES as readonly string[]).includes(seen) ? seen : "unknown";
    const current = surface.get(user);
    if (!current || next === "installed" || (current === "unknown" && next !== "unknown")) surface.set(user, next);
    const bucket = sessions.get(row.session_id) ?? { views: 0, opens: 0 };
    if (row.event_type === "page_view") bucket.views += 1;
    if (row.event_type === "video_open" || row.event_type === "qualified_view") bucket.opens += 1;
    sessions.set(row.session_id, bucket);
  }
  const group = (assign: Map<string, string>) => {
    const out: Record<string, ReturnGroup> = Object.create(null);
    for (const [user, key] of assign) {
      const entry = out[key] ?? (out[key] = { users: 0, returningUsers: 0 });
      entry.users += 1;
      if ((days.get(user)?.size ?? 0) >= 2) entry.returningUsers += 1;
    }
    return out;
  };
  let bounceSessions = 0;
  for (const bucket of sessions.values()) if (bucket.opens === 0 && bucket.views <= 1) bounceSessions += 1;
  return {
    returnByAcquisition: group(firstAcquisition),
    returnBySurface: group(surface),
    bounce: {
      sessions: sessions.size,
      bounceSessions,
      bounceRate: sessions.size ? Number(((bounceSessions / sessions.size) * 100).toFixed(1)) : 0
    }
  };
}
