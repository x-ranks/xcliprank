import { predictLabels } from "./label-learning-core";
import type { LabelState } from "./label-learning-service";

// Read-only, bounded numerical summary. No features, weights, frames or media URLs
// are returned. These in-sample figures are not a generalisation accuracy test.
export function labelA4Diagnostics(state: LabelState, stale: boolean) {
  const active = state.labels.filter(label => label.active);
  const train = state.videos.filter(video => video.review?.role === "train" && Object.values(video.review.decisions).some(value => typeof value === "boolean"));
  const comparisons = [0.5, 0.7, 0.9].map(threshold => ({ threshold, videos: 0, tagged: 0, tp: 0, fp: 0, fn: 0, tn: 0 }));
  if (state.model && !stale) {
    const ids = new Set(active.map(label => label.id));
    for (const video of train) {
      const predictions = predictLabels(state.model.head, video.features).filter(p => ids.has(p.id));
      for (const row of comparisons) {
        row.videos++;
        if (predictions.some(p => p.score !== null && p.score >= row.threshold)) row.tagged++;
        for (const prediction of predictions) {
          const truth = video.review!.decisions[prediction.id];
          if (typeof truth !== "boolean" || prediction.score === null) continue;
          const selected = prediction.score >= row.threshold;
          row[selected ? truth ? "tp" : "fp" : truth ? "fn" : "tn"]++;
        }
      }
    }
  }
  const labels = active.map(label => {
    const positive = train.filter(video => video.review!.decisions[label.id] === true);
    const negative = train.filter(video => video.review!.decisions[label.id] === false).length;
    const authors = new Set(positive.map(video => video.authorKey ?? video.author?.toLowerCase()).filter(Boolean)).size;
    const head = state.model?.head.heads.find(head => head.id === label.id);
    const metric = !stale ? state.model?.crossCheck.report?.labels.find(row => row.id === label.id) : null;
    return { id: label.id, name: label.name, positive: positive.length, negative, positiveAuthors: authors,
      trained: Boolean(head?.weights) && !stale,
      guidance: positive.length < 2 || negative < 2 ? "untrained" : positive.length < 10 || negative < 10 || authors < 3 ? "examples" : "validation",
      crossCheck: metric ? { known: metric.known, scored: metric.scored, precision: metric.precision, recall: metric.recall } : null };
  }).sort((a, b) => Number(a.trained) - Number(b.trained) || a.positive - b.positive || a.name.localeCompare(b.name, "ja"));
  return { prepared: state.videos.length, training: train.length,
    unreviewed: state.videos.filter(video => !video.review).length,
    testReviewed: state.videos.filter(video => video.review?.role === "test").length,
    independentTestVideos: state.testReport?.videos ?? 0,
    modelSamples: state.model?.head.samples ?? 0, stale, comparisons, labels };
}
