"use client";

export type EngagementEventType =
  | "page_view"
  | "video_open"
  | "qualified_view"
  | "ranking_change"
  | "outbound_x";

type EngagementPayload = {
  eventType: EngagementEventType;
  xPostId?: string;
  range?: string;
  source?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

const ANONYMOUS_KEY = "xcliprank_anonymous_id";
const SESSION_KEY = "xcliprank_session_id";
const ACQUISITION_KEY = "xcliprank_acquisition";

type Acquisition = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  referrerHost: string | null;
  landingPath: string;
};

function createId() {
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

  const created = createId();
  storage.setItem(key, created);
  return created;
}

function shortText(value: string | null, maximum = 120) {
  return value ? value.slice(0, maximum) : null;
}

function getAcquisition(): Acquisition {
  const stored = window.sessionStorage.getItem(ACQUISITION_KEY);
  if (stored) {
    try {
      return JSON.parse(stored) as Acquisition;
    } catch {
      window.sessionStorage.removeItem(ACQUISITION_KEY);
    }
  }

  const params = new URLSearchParams(window.location.search);
  let referrerHost: string | null = null;
  try {
    referrerHost = document.referrer
      ? shortText(new URL(document.referrer).hostname.toLowerCase())
      : null;
  } catch {
    referrerHost = null;
  }

  const acquisition: Acquisition = {
    utmSource: shortText(params.get("utm_source")),
    utmMedium: shortText(params.get("utm_medium")),
    utmCampaign: shortText(params.get("utm_campaign")),
    utmContent: shortText(params.get("utm_content")),
    referrerHost,
    landingPath: window.location.pathname.slice(0, 160),
  };
  window.sessionStorage.setItem(ACQUISITION_KEY, JSON.stringify(acquisition));
  return acquisition;
}

export function trackEngagement(payload: EngagementPayload) {
  if (typeof window === "undefined") return;

  try {
    const body = JSON.stringify({
      ...payload,
      metadata: {
        ...getAcquisition(),
        ...(payload.metadata ?? {}),
      },
      anonymousId: getOrCreateId(window.localStorage, ANONYMOUS_KEY),
      sessionId: getOrCreateId(window.sessionStorage, SESSION_KEY)
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
