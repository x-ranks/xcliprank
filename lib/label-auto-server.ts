import path from "node:path";
import { createAutoLabels } from "./label-auto-service";
import { labelPublicationSnapshot, labelPublicationRemote } from "./label-publication-server";
import { prepareLabelVideo } from "./label-learning-video";
export const autoLabels = createAutoLabels(path.join(process.cwd(), ".local-admin", "label-auto-v1"), { snapshot: labelPublicationSnapshot, remote: labelPublicationRemote, prepare: prepareLabelVideo });
