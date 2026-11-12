import { headers } from "next/headers";
import AgeGate from "./AgeGate";

// The marker is set by the origin only after it has verified a Cloudflare-signed proof for this exact request
// (see scripts/origin-pilot.cjs). Clients cannot send it: the origin deletes any incoming copy.
const VERIFIED_GOOGLEBOT_HEADER = "x-twizou-verified-googlebot";

export default async function RequestAgeGate() {
  const verifiedGooglebot = (await headers()).get(VERIFIED_GOOGLEBOT_HEADER) === "1";
  return <AgeGate verifiedGooglebot={verifiedGooglebot} />;
}
