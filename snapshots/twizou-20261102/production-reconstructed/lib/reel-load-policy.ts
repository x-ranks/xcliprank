export type ConnectionHint = { saveData?: boolean; effectiveType?: string };
export function reducedMediaData(connection?: ConnectionHint): boolean {
  return Boolean(connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? ""));
}
// Adjacent slides keep their layout, but distant media never gets a URL.
export function reelLoadPolicy(index: number, activeIndex: number, reduced: boolean) {
  const active = index === activeIndex;
  return { mountVideo: active || (!reduced && index === activeIndex + 1),
    loadPoster: Math.abs(index - activeIndex) <= (reduced ? 1 : 2),
    preload: active ? "auto" as const : "metadata" as const };
}
