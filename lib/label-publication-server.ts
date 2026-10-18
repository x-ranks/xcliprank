import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { labelService } from "./label-learning-server";
import type { LabelState } from "./label-learning-service";
import { prepareLabelVideo } from "./label-learning-video";
import { localDatabaseHost } from "./free-curated-client";
import { createLabelPublication } from "./label-publication-service";
async function snapshot() {
  const file = path.join(process.cwd(), ".local-admin", "label-learning-v1", "state.json"), view = await labelService.status();
  if (!view.model || view.model.stale) throw Error("LABEL_PUBLIC_TRAIN_FIRST");
  const bytes = await fs.readFile(file), state = JSON.parse(bytes.toString("utf8")) as LabelState;
  if (state.revision !== view.revision || state.model?.id !== view.model.id) throw Error("LABEL_PUBLIC_SOURCE_CHANGED");
  return { state, stamp: createHash("sha256").update(bytes).digest("hex") };
}
async function remote(body: object) {
  const secret = process.env.CRON_SECRET, databaseHost = localDatabaseHost(); if (!secret || !databaseHost) throw Error("LABEL_PUBLIC_CONFIG_MISSING");
  let r: Response; try { r = await fetch("https://xcliprank.com/api/public-label-admin", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + secret }, body: JSON.stringify({ ...body, databaseHost }), cache: "no-store", redirect: "error", credentials: "omit", signal: AbortSignal.timeout(45000) }); } catch { throw Error("LABEL_PUBLIC_REMOTE_UNAVAILABLE"); }
  if (!r.headers.get("content-type")?.includes("application/json")) { await r.body?.cancel(); throw Error("LABEL_PUBLIC_DEPLOY_FIRST"); }
  const data = await r.json(); if (!r.ok || !data.ok) throw Error(r.status === 401 ? "LABEL_PUBLIC_AUTH_FAILED" : r.status === 409 ? "LABEL_PUBLIC_REMOTE_STALE" : "LABEL_PUBLIC_REMOTE_UNAVAILABLE"); return data.data;
}
export const labelPublication = createLabelPublication(path.join(process.cwd(), ".local-admin", "label-publication-v1"), { snapshot, remote, prepare: prepareLabelVideo });
