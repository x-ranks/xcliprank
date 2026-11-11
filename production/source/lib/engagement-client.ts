"use client";

export type EngagementEventType =
  | "page_view"
  | "video_open"
  | "qualified_view"
  | "ranking_change"
  | "outbound_x";

type EngagementPayload = {
  eventType: EngagementEventType;
  occurrenceId?: string;
  xPostId?: string;
  range?: string;
  source?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

const ANONYMOUS_KEY = "xcliprank_anonymous_id";
const SESSION_KEY = "xcliprank_session_id";
const ACQUISITION_KEY = "xcliprank_acquisition";
// A visit continues across tabs until 30 minutes pass without a tracked event.
const SESSION_V2_KEY = "twizou_session_v2";
const SESSION_IDLE_MS = 30 * 60 * 1000;
const OWN_HOSTS = new Set(["twizou.net", "www.twizou.net", "xcliprank.com", "www.xcliprank.com"]);

type Acquisition = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  referrerHost: string | null;
  landingPath: string;
};

export function createEngagementEventId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function getOrCreateId(storage: Storage, key: string) {
  const existing = storage.getItem(key);
  if (existing) return existing;

  const created = createEngagementEventId();
  storage.setItem(key, created);
  return created;
}

function getAnonymousId() {
  try {
    return getOrCreateId(window.localStorage, ANONYMOUS_KEY);
  } catch {
    return getOrCreateId(window.sessionStorage, ANONYMOUS_KEY);
  }
}

function shortText(value: string | null, maximum = 120) {
  return value ? value.slice(0, maximum) : null;
}

// Links inside the site are navigation, not a traffic source.
function externalReferrerHost(): string | null {
  try {
    if (!document.referrer) return null;
    const host = new URL(document.referrer).hostname.toLowerCase();
    return OWN_HOSTS.has(host) ? null : shortText(host);
  } catch {
    return null;
  }
}

function newAcquisition(): Acquisition {
  const params = new URLSearchParams(window.location.search);
  return {
    utmSource: shortText(params.get("utm_source")),
    utmMedium: shortText(params.get("utm_medium")),
    utmCampaign: shortText(params.get("utm_campaign")),
    utmContent: shortText(params.get("utm_content")),
    referrerHost: externalReferrerHost(),
    landingPath: window.location.pathname.slice(0, 160),
  };
}

// Per-tab fallback, used only when localStorage is unavailable.
function getAcquisition(): Acquisition {
  const stored = window.sessionStorage.getItem(ACQUISITION_KEY);
  if (stored) {
    try {
      return JSON.parse(stored) as Acquisition;
    } catch {
      window.sessionStorage.removeItem(ACQUISITION_KEY);
    }
  }
  const acquisition = newAcquisition();
  window.sessionStorage.setItem(ACQUISITION_KEY, JSON.stringify(acquisition));
  return acquisition;
}

type SessionState = { id: string; last: number; acquisition: Acquisition };

function getSession(): { id: string; acquisition: Acquisition } {
  try {
    const now = Date.now();
    const raw = window.localStorage.getItem(SESSION_V2_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as SessionState;
      if (stored && typeof stored.id === "string" && stored.id.length <= 100 && typeof stored.last === "number" &&
        stored.acquisition && now - stored.last < SESSION_IDLE_MS) {
        const continued: SessionState = { id: stored.id, last: now, acquisition: stored.acquisition };
        window.localStorage.setItem(SESSION_V2_KEY, JSON.stringify(continued));
        return continued;
      }
    }
    const created: SessionState = { id: createEngagementEventId(), last: now, acquisition: newAcquisition() };
    window.localStorage.setItem(SESSION_V2_KEY, JSON.stringify(created));
    return created;
  } catch {
    return { id: getOrCreateId(window.sessionStorage, SESSION_KEY), acquisition: getAcquisition() };
  }
}

export function trackEngagement(payload: EngagementPayload) {
  if (typeof window === "undefined") return;

  try {
    const session = getSession();
    const body = JSON.stringify({
      ...payload,
      ...(["page_view", "video_open", "qualified_view"].includes(payload.eventType) ? { pageViewId: payload.occurrenceId ?? createEngagementEventId() } : {}),
      metadata: {
        ...session.acquisition,
        ...(payload.metadata ?? {}),
      },
      anonymousId: getAnonymousId(),
      sessionId: session.id
    });

    if (navigator.sendBeacon) {
      const accepted = navigator.sendBeacon(
        "/api/engagement",
        new Blob([body], { type: "application/json" })
      );
      if (accepted) return;
    }

    void fetch("/api/engagement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin"
    });
  } catch {
    // Analytics must never interrupt video browsing.
  }
}
