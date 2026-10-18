export type AuthorIdentity = { author_id?: unknown; author_username?: unknown };
export function authorKey(author: AuthorIdentity): string | null {
  const id = String(author.author_id ?? "");
  if (/^\d{2,20}$/.test(id)) return `id:${id}`;
  const name = String(author.author_username ?? "").replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(name) ? `name:${name}` : null;
}
export function isSuspendedAuthor(author: AuthorIdentity, blocked: ReadonlySet<string>) {
  const key = authorKey(author);
  return key !== null && blocked.has(key);
}
export type AuthorOutcome = "public" | "suspended" | "unknown";
export function classifyAuthorResponse(key: string, http: number, body: any): AuthorOutcome {
  if (![200, 403, 404].includes(http) || !body || ![200, 403, 404].includes(body.code)) return "unknown";
  const requestedId = key.startsWith("id:") ? key.slice(3) : null;
  const returnedIds = [body.id, body.user?.id].filter(id => id !== undefined);
  if (requestedId && returnedIds.some(id => String(id) !== requestedId)) return "unknown";
  if (body.reason === "suspended" && [403, 404].includes(body.code)) return "suspended";
  if (http !== 200 || body.code !== 200 || body.reason || body.user?.type !== "profile" ||
      !/^\d{2,20}$/.test(String(body.user.id ?? "")) || typeof body.user.protected !== "boolean") return "unknown";
  if (key.startsWith("name:") && String(body.user.screen_name ?? "").toLowerCase() !== key.slice(5)) return "unknown";
  // Private/not-found is not proof of suspension. Only an explicit public profile clears a block.
  return body.user.protected === false ? "public" : "unknown";
}
