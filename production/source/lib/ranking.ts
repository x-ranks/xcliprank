export function rankingScore(input: {
  views: number;
  likes: number;
  reposts: number;
  replies: number;
  createdAt: string;
}) {
  const ageHours = Math.max(
    1,
    (Date.now() - new Date(input.createdAt).getTime()) / 3_600_000
  );

  // Simple MVP score:
  // engagement + freshness + velocity.
  const engagement =
    input.views * 0.001 +
    input.likes * 2 +
    input.reposts * 5 +
    input.replies;

  const velocity = (input.views + input.likes * 8 + input.reposts * 20) / ageHours;
  const freshness = 1 / Math.pow(ageHours + 2, 0.35);

  return Math.round((engagement + velocity * 0.15) * freshness);
}
