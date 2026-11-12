/** Where the page is shown: the installed home-screen app, an app's built-in browser, or a normal browser. */
export type Surface = "installed" | "x-app" | "other-app" | "browser";
export const SURFACES: readonly Surface[] = ["installed", "x-app", "other-app", "browser"];

// Only browsers that announce themselves can be told apart. Custom Tabs / SFSafariViewController look like normal
// browsers, so "browser" also contains some in-app visits.
const X_APP = /\bTwitter(?:Android)?\b|Twitter for (?:iPhone|Android|iPad)/i;
const OTHER_APP = /\bLine\/|\bFBAN\b|\bFBAV\b|\bInstagram\b|MicroMessenger|\bwv\)/i;

export function detectSurface(standalone: boolean, userAgent: string): Surface {
  if (standalone) return "installed";
  const ua = String(userAgent ?? "").slice(0, 400);
  if (X_APP.test(ua)) return "x-app";
  if (OTHER_APP.test(ua)) return "other-app";
  return "browser";
}

export function isStandaloneDisplay(win: { matchMedia?: (query: string) => { matches: boolean }; navigator?: { standalone?: boolean } }): boolean {
  try {
    return Boolean(win.matchMedia?.("(display-mode: standalone)").matches) || win.navigator?.standalone === true;
  } catch {
    return false;
  }
}
