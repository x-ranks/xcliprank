import { promises as fs } from "node:fs";
import path from "node:path";
import { labelService } from "./label-learning-server";
import { labelA4Diagnostics } from "./label-a4-diagnostics";
import type { LabelState } from "./label-learning-service";

export async function readLabelA4Diagnostics() {
  // Existing status performs the complete state and path validation first.
  const view = await labelService.status();
  if (!view.model && !view.videos.length) return labelA4Diagnostics({ version: 1, revision: 0, labels: view.labels, videos: [], attempted: [], everTrained: [], everTrainedAuthors: [], model: null, testReport: null }, false);
  const file = path.join(process.cwd(), ".local-admin", "label-learning-v1", "state.json");
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20 * 1024 * 1024) throw Error("LABEL_STATE_CORRUPT");
  const state = JSON.parse(await fs.readFile(file, "utf8")) as LabelState;
  if (state.revision !== view.revision || state.model?.id !== view.model?.id) throw Error("LABEL_STALE_SCREEN");
  return labelA4Diagnostics(state, view.model?.stale ?? false);
}
