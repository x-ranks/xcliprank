export const PUBLIC_DETAIL_OPEN_EVENT = "twizou:open-detail-v1";
// No page payload or video is prefetched. The mounted viewer may accept a click.
export function requestPublicDetail(id: string): boolean {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function" || typeof CustomEvent !== "function" || !/^[1-9][0-9]{1,24}$/.test(id)) return false;
  const event = new CustomEvent(PUBLIC_DETAIL_OPEN_EVENT, { cancelable: true, detail: { id } });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
