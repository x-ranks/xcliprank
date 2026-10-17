// Shared by the UI and offline tests. No storage or network access.
export type LabelPurpose = "train" | "test";
export type PreparedVideo = { preparedFor?: LabelPurpose; review: { role: LabelPurpose } | null };
export function preparedCount(videos: PreparedVideo[], purpose: LabelPurpose) {
  return videos.filter(v => (v.review?.role ?? v.preparedFor ?? "train") === purpose).length;
}
export function preparationGoal(videos: PreparedVideo[], purpose: LabelPurpose, size: 10 | 100) {
  const existing = preparedCount(videos, purpose);
  return size === 100 && purpose === "train" ? Math.max(existing, 100) : Math.min(300, existing + size);
}
export function remainingPreparation(videos: PreparedVideo[], purpose: LabelPurpose, goal: number) {
  return Math.max(0, Math.min(goal - preparedCount(videos, purpose), 300 - videos.length));
}
