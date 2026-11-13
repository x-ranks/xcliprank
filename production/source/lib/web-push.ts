/** Web Push without third-party packages: RFC 8291 (aes128gcm message encryption) and RFC 8292 (VAPID). Node crypto only. */
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from "node:crypto";

export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };
export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const fromB64u = (value: string) => Buffer.from(value, "base64url");
const RECORD_SIZE = 4096;
export const MAX_PUSH_PLAINTEXT = 2000;

/** Push services we accept endpoints from. Anything else could point the server at an arbitrary address. */
export function allowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 600) return false;
  let url: URL; try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const host = url.hostname.toLowerCase();
  return host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" || host.endsWith(".push.services.mozilla.com")
    || host === "web.push.apple.com" || host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com");
}

/** A browser's public key (65-byte uncompressed P-256 point) and auth secret (16 bytes), both base64url. */
export function validSubscriptionKeys(p256dh: unknown, auth: unknown): boolean {
  if (typeof p256dh !== "string" || typeof auth !== "string" || !/^[A-Za-z0-9_-]+$/.test(p256dh) || !/^[A-Za-z0-9_-]+$/.test(auth)) return false;
  const key = fromB64u(p256dh), secret = fromB64u(auth);
  return key.length === 65 && key[0] === 4 && secret.length === 16;
}

/** RFC 8291 section 3: one aes128gcm record. senderPrivate and salt are injectable for the RFC test vector only. */
export function encryptWebPush(plaintext: Uint8Array, subscription: Pick<PushSubscriptionKeys, "p256dh" | "auth">, inject: { senderPrivate?: Buffer; salt?: Buffer } = {}): Buffer {
  if (plaintext.length > MAX_PUSH_PLAINTEXT) throw Error("PUSH_PAYLOAD_TOO_LARGE");
  const uaPublic = fromB64u(subscription.p256dh), authSecret = fromB64u(subscription.auth);
  const ecdh = createECDH("prime256v1");
  if (inject.senderPrivate) ecdh.setPrivateKey(inject.senderPrivate); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(), salt = inject.salt ?? randomBytes(16);
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21); salt.copy(header, 0); header.writeUInt32BE(RECORD_SIZE, 16); header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}

/** RFC 8292: Authorization header value for an endpoint. */
export function vapidAuthorization(endpoint: string, vapid: VapidConfig, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const audience = new URL(endpoint).origin;
  const publicKey = fromB64u(vapid.publicKey), d = fromB64u(vapid.privateKey);
  if (publicKey.length !== 65 || publicKey[0] !== 4 || d.length !== 32) throw Error("PUSH_VAPID_KEY_INVALID");
  const key = createPrivateKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: b64u(publicKey.subarray(1, 33)), y: b64u(publicKey.subarray(33, 65)), d: b64u(d) } });
  const input = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" }))) + "." + b64u(Buffer.from(JSON.stringify({ aud: audience, exp: nowSeconds + 12 * 3600, sub: vapid.subject })));
  const signature = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${input}.${b64u(signature)}, k=${vapid.publicKey}`;
}

export function readVapidConfig(env: Record<string, string | undefined> = process.env): VapidConfig | null {
  const publicKey = env.PUSH_VAPID_PUBLIC_KEY?.trim(), privateKey = env.PUSH_VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey || fromB64u(publicKey).length !== 65 || fromB64u(privateKey).length !== 32) return null;
  return { publicKey, privateKey, subject: env.PUSH_VAPID_SUBJECT?.trim() || "https://twizou.net" };
}

/** One generic notification. Content is deliberately plain: it shows on a lock screen. Returns the push service's HTTP status (0 = network failure). */
export async function sendWebPush(subscription: PushSubscriptionKeys, message: { title: string; body: string; url: string }, vapid: VapidConfig, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!allowedPushEndpoint(subscription.endpoint) || !validSubscriptionKeys(subscription.p256dh, subscription.auth)) return 0;
  try {
    const response = await fetchImpl(subscription.endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { Authorization: vapidAuthorization(subscription.endpoint, vapid), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "43200", Urgency: "low" },
      body: new Uint8Array(encryptWebPush(Buffer.from(JSON.stringify(message)), subscription)) });
    return response.status;
  } catch { return 0; }
}

/** For scripts/generate-vapid.cjs and tests: a new VAPID key pair as base64url strings. */
export function generateVapidKeys() {
  const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}
