import { writeFile } from 'node:fs/promises';
import ipaddr from 'ipaddr.js';

const url = 'https://developers.google.com/static/crawling/ipranges/common-crawlers.json';
const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
if (!response.ok) throw new Error('GOOGLE_RANGE_DOWNLOAD_FAILED');
const { prefixes } = await response.json();
if (!Array.isArray(prefixes) || prefixes.length < 10 || prefixes.length > 2000) {
  throw new Error('GOOGLE_RANGE_LIST_INVALID');
}
const ranges = prefixes.map(({ ipv4Prefix, ipv6Prefix }) => {
  const prefix = ipv4Prefix ?? ipv6Prefix;
  const [network, bits] = ipaddr.parseCIDR(prefix);
  if (network.range() !== 'unicast' || bits < (ipv4Prefix ? 16 : 24)) {
    throw new Error('GOOGLE_RANGE_TOO_BROAD_OR_RESERVED');
  }
  return prefix;
});
await writeFile(new URL('ranges.generated.mjs', import.meta.url),
  'export default ' + JSON.stringify({ fetchedAt: Date.now(), ranges }) + ';\n');
console.log('GOOGLE_COMMON_RANGES_READY count=' + ranges.length);
