import { readPublicDetailCore } from "./public-video-server";
import { PILOT_VIDEO_IDS } from "./video-sitemap-pilot";

export function readVideoSitemapPilot() {
  return Promise.all(PILOT_VIDEO_IDS.map(id => readPublicDetailCore(id)));
}
