import { supabaseAdmin } from "./supabase-admin";
import type { PushStore } from "./push-service";

const TABLE = "push_subscriptions";
/** Supabase-backed storage. Rows whose sends keep failing for ten runs are dropped. */
export function supabasePushStore(client: ReturnType<typeof supabaseAdmin> = supabaseAdmin()): PushStore {
  const fail = (error: { message: string } | null) => { if (error) throw Error("PUSH_STORE_" + error.message.slice(0, 80)); };
  return {
    async count() { const { count, error } = await client.from(TABLE).select("id", { count: "exact", head: true }); fail(error); return count ?? 0; },
    async upsert(row) {
      const { error } = await client.from(TABLE).upsert({ endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth, follows: row.follows, fail_count: 0 }, { onConflict: "endpoint" }); fail(error);
    },
    async remove(endpoint) { const { error } = await client.from(TABLE).delete().eq("endpoint", endpoint); fail(error); },
    async removeIds(ids) { if (!ids.length) return; const { error } = await client.from(TABLE).delete().in("id", ids); fail(error); },
    async page(afterId, limit) {
      const { data, error } = await client.from(TABLE).select("id,endpoint,p256dh,auth,follows,notified_through").gt("id", afterId).order("id").limit(limit); fail(error);
      return (data ?? []).map((r: Record<string, unknown>) => ({ id: r.id as number, endpoint: r.endpoint as string, p256dh: r.p256dh as string, auth: r.auth as string, follows: (r.follows ?? []) as string[], notifiedThrough: r.notified_through as string }));
    },
    async markChecked(ids, through) { const { error } = await client.from(TABLE).update({ notified_through: through, fail_count: 0 }).in("id", ids); fail(error); },
    async markSent(ids, through) { const { error } = await client.from(TABLE).update({ notified_through: through, last_sent_at: through, fail_count: 0 }).in("id", ids); fail(error); },
    async markFailed(ids) {
      for (const id of ids) {
        const { data, error } = await client.from(TABLE).select("fail_count").eq("id", id).maybeSingle(); fail(error);
        const next = ((data?.fail_count as number | undefined) ?? 0) + 1;
        const result = next >= 10 ? await client.from(TABLE).delete().eq("id", id) : await client.from(TABLE).update({ fail_count: next }).eq("id", id); fail(result.error);
      }
    }
  };
}
