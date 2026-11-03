import { authorHref, type PublicLabel, type PublicVideo, type videoMetadata } from "./public-video-core";
import { isoVideoDuration, matchingVideoTechnical } from "./video-technical";
export function publicVideoSchema(video: PublicVideo, metadata: ReturnType<typeof videoMetadata>, labels: PublicLabel[], stored: unknown = null) {
  if (!video.eligible || !video.posterUrl || !video.createdAt || !Number.isFinite(Date.parse(video.createdAt))) return null;
  const technical = matchingVideoTechnical(stored, video.sourceHash), duration = technical && isoVideoDuration(technical.durationSeconds);
  const author = video.authorName?.trim() || (video.handle ? "@" + video.handle : null), authorPath = authorHref(video);
  return { "@context": "https://schema.org", "@type": "VideoObject", "@id": metadata.canonical + "#video", identifier: video.id,
    name: metadata.title, description: metadata.description, thumbnailUrl: video.posterUrl, uploadDate: video.createdAt,
    contentUrl: video.videoUrl, url: metadata.canonical, mainEntityOfPage: metadata.canonical, isFamilyFriendly: false,
    ...(duration ? { duration } : {}),
    ...(technical?.width ? { width: { "@type": "QuantitativeValue", value: technical.width, unitText: "px" } } : {}),
    ...(technical?.height ? { height: { "@type": "QuantitativeValue", value: technical.height, unitText: "px" } } : {}),
    ...(author && authorPath ? { author: { "@type": "Person", name: author, url: "https://twizou.net" + authorPath } } : {}),
    ...(labels.length ? { keywords: [...new Set(labels.filter(label => label.active).map(label => label.name))] } : {})
  };
}
