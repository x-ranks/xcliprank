// Short-lived server data cache. It never stores video bytes or changes HTTP
// cache policy. The caller supplies a fresh publication-control signature.
type Snapshot = { text: string; status: number; statusText: string; headers: [string, string][]; started: number; bytes: number };
export function createRankingReadCache({ now = () => performance.now(), ttlMs = 30000, maxBytes = 8 * 1024 * 1024, maxEntries = 32 } = {}) {
  const entries = new Map<string, Snapshot>(), flights = new Map<string, Promise<Snapshot>>();
  let bytes = 0;
  function remove(key: string) { const old = entries.get(key); if (old) bytes -= old.bytes; entries.delete(key); }
  function response(value: Snapshot, status: "HIT" | "MISS" | "SHARED", started: number) {
    const headers = new Headers(value.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Twizou-Ranking-Cache", status);
    headers.set("X-Twizou-Ranking-Cache-Age-Ms", String(Math.max(0, now() - value.started)));
    if (status !== "MISS") headers.set("Server-Timing", `cache;desc="${status}", history;dur=0.0, ranking;dur=${Math.max(0, now()-started).toFixed(1)}`);
    return new Response(value.text, { status: value.status, statusText: value.statusText, headers });
  }
  async function get(key: string, load: () => Promise<Response>, refresh = false) {
    const started = now();
    for (const [k, value] of entries) if (now() - value.started >= ttlMs) remove(k);
    const old = entries.get(key);
    if (old && !refresh) { entries.delete(key); entries.set(key, old); return response(old, "HIT", started); }
    const pending = flights.get(key);
    if (pending) {
      const value = await pending;
      // A future producer that sets a cookie must never share that response.
      if (new Headers(value.headers).has("set-cookie")) return load();
      return response(value, "SHARED", started);
    }
    if (key.length > 262144 || flights.size >= 8) return load();
    const work = (async () => {
      const result = await load(), text = await result.text();
      const snapshot: Snapshot = { text, status: result.status, statusText: result.statusText, headers: [...result.headers.entries()], started, bytes: new TextEncoder().encode(text).byteLength };
      if (result.status === 200 && result.headers.get("content-type")?.includes("application/json") && !result.headers.has("set-cookie") && snapshot.bytes <= 2 * 1024 * 1024 && now() - started < ttlMs) {
        remove(key);
        while (entries.size && (entries.size >= maxEntries || bytes + snapshot.bytes > maxBytes)) remove(entries.keys().next().value!);
        if (snapshot.bytes <= maxBytes) { entries.set(key, snapshot); bytes += snapshot.bytes; }
      }
      return snapshot;
    })();
    flights.set(key, work);
    try { return response(await work, "MISS", started); }
    finally { if (flights.get(key) === work) flights.delete(key); }
  }
  return { get, refresh: (key: string, load: () => Promise<Response>) => get(key, load, true) };
}
