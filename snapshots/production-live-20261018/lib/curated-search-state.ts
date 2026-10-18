export type CuratedPendingSearch = {
  startTime: string;
  endTime: string;
  untilId: string;
  latestPostId: string | null;
};

export function maxPostId(ids: (string | null | undefined)[]): string | null {
  return ids.filter((id): id is string => Boolean(id)).reduce<string | null>(
    (latest, id) => !latest || BigInt(id) > BigInt(latest) ? id : latest, null
  );
}

// Only call after both post and snapshot writes have succeeded.
export function nextCuratedSearchState(input: {
  pending: CuratedPendingSearch | null;
  startTime: string;
  endTime: string;
  incomplete: boolean;
  oldestPostId: string | null;
  newestPostId: string | null;
  previousPostId: string | null;
}) {
  const latestPostId = maxPostId([input.pending?.latestPostId, input.newestPostId]);
  if (input.incomplete) {
    if (!input.oldestPostId) throw new Error("Recent Search returned an empty unfinished page.");
    return {
      pending: {
        startTime: input.startTime, endTime: input.endTime,
        untilId: input.oldestPostId, latestPostId,
      } satisfies CuratedPendingSearch,
      lastPostId: input.previousPostId,
      completedAt: null,
    };
  }
  return {
    pending: null,
    lastPostId: maxPostId([input.previousPostId, latestPostId]),
    completedAt: input.endTime,
  };
}
