import { videoLabels, videoMetadata } from "./public-video-core";
import { productionPublicBackend } from "./public-video-production";
import { PILOT_VIDEO_IDS } from "./video-sitemap-pilot";

export async function readVideoSitemapPilot() {
  const { service, catalog } = productionPublicBackend({ readOnlyRender: true });
  const ids = [...PILOT_VIDEO_IDS];
  const [videos, records] = await Promise.all([service.inspect(ids), catalog.readForIds(ids)]);
  return videos.map(video => {
    const labels = videoLabels(records, video);
    return { video, labels, metadata: videoMetadata(video, records.records[video.id] ?? null, labels) };
  });
}
