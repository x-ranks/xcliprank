export const dynamic = "force-static";
// The service worker only shows plain notifications and opens the site. It does not cache or intercept requests.
const SCRIPT = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) { data = {}; }
  const title = typeof data.title === "string" && data.title ? data.title.slice(0, 60) : "twizou";
  const body = typeof data.body === "string" ? data.body.slice(0, 120) : "新着があります";
  const url = typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : "/following";
  event.waitUntil(self.registration.showNotification(title, { body, icon: "/icon-192.png", tag: "twizou-follow", data: { url } }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/following", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const client of list) if (client.url.startsWith(self.location.origin) && "focus" in client) return client.focus().then(() => "navigate" in client ? client.navigate(target) : undefined);
    return self.clients.openWindow(target);
  }));
});
`;
export function GET() {
  return new Response(SCRIPT, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/", "X-Robots-Tag": "noindex" } });
}
