/**
 * Host checks for a URL a user supplied.
 *
 * The protocol check alone is not a defence: `http://127.0.0.1:8080/admin`,
 * `http://10.0.0.5/` and `http://169.254.169.254/latest/meta-data/` are all
 * valid `http:` URLs, and a downloader that fetches them turns the API into a
 * server-side request forgery gadget pointed at the private network it runs in
 * (and, on a cloud host, at the instance metadata service).
 *
 * Scope and limits, stated plainly:
 * - This rejects literal internal addresses and obviously internal names.
 * - It cannot stop DNS rebinding, where a public name resolves to a private
 *   address at fetch time. Whoever performs the actual request must re-check the
 *   resolved address and pin the connection to it. That belongs to the download
 *   worker, not to request validation, and is a job for the pipeline phase.
 */

/** IPv4 ranges that are not routable on the public internet. */
const BLOCKED_IPV4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // RFC 1918 private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata at 169.254.169.254
  ['172.16.0.0', 12], // RFC 1918 private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // RFC 1918 private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes 255.255.255.255
];

/** Suffixes that name something inside a private network. */
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan'];

function ipv4ToInt(host: string): number | null {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return null;
  }

  let value = 0;
  for (const part of parts) {
    // Reject empty, non-numeric and zero-padded forms; `010.0.0.1` is parsed as
    // octal by some resolvers, which makes naive string comparison unsafe.
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    if (part.length > 1 && part.startsWith('0')) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    value = value * 256 + octet;
  }

  return value;
}

function isBlockedIpv4Address(address: number): boolean {
  return BLOCKED_IPV4_RANGES.some(([network, bits]) => {
    const base = ipv4ToInt(network);
    if (base === null) {
      return false;
    }
    const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
    return ((address & mask) >>> 0) === ((base & mask) >>> 0);
  });
}

function isBlockedIpv4(host: string): boolean {
  const address = ipv4ToInt(host);
  return address !== null && isBlockedIpv4Address(address);
}

/**
 * Reads the low 32 bits of an IPv6 address as an IPv4 address.
 *
 * `URL` normalises the IPv4-mapped form, so `http://[::ffff:127.0.0.1]/` arrives
 * as `::ffff:7f00:1`. A dotted quad is not there to find, and the embedded
 * address has to be decoded from hex instead.
 */
function low32BitsAsIpv4(bare: string): number | null {
  const groups = bare.split(':').filter((group) => group.length > 0);
  if (groups.length < 2) {
    return null;
  }

  const high = Number.parseInt(groups[groups.length - 2] ?? '', 16);
  const low = Number.parseInt(groups[groups.length - 1] ?? '', 16);
  if (Number.isNaN(high) || Number.isNaN(low)) {
    return null;
  }

  return ((high & 0xffff) << 16) | (low & 0xffff);
}

function isBlockedIpv6(host: string): boolean {
  // `URL.hostname` keeps the brackets around an IPv6 literal.
  const bare = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();

  if (bare === '::' || bare === '::1') {
    return true;
  }
  // IPv4-mapped and IPv4-compatible forms, e.g. ::ffff:7f00:1.
  if (bare.startsWith('::ffff:') || bare.startsWith('::')) {
    const embedded = low32BitsAsIpv4(bare);
    if (embedded !== null) {
      return isBlockedIpv4Address(embedded);
    }
  }
  // Unique local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd]/.test(bare) || /^fe[89ab]/.test(bare)) {
    return true;
  }
  // Multicast (ff00::/8) and the unspecified 0::/8.
  if (/^ff[0-9a-f]{0,2}:/.test(bare) || /^0{1,4}:/.test(bare)) {
    return true;
  }

  return false;
}

/**
 * Whether a hostname may be fetched by the downloader.
 *
 * Accepts a hostname rather than a full URL so it can be reused by the worker
 * for the post-DNS-resolution check.
 */
export function isSafeSourceHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (host.length === 0) {
    return false;
  }

  if (host.startsWith('[') || host.includes(':')) {
    return !isBlockedIpv6(host);
  }

  if (/^\d{1,3}(\.\d{1,3}){0,3}$/.test(host)) {
    // A bare IPv4 literal is only safe if the address itself is public.
    return !isBlockedIpv4(host);
  }

  if (host === 'localhost' || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return false;
  }

  return true;
}
