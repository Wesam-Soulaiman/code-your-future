/**
 * Validating the links a Student submits ⟨CP7⟩.
 *
 * ── Nothing here touches the network ────────────────────────────────────────
 * No DNS resolution, no HEAD request, no availability probe. Not because it
 * would be hard, but because a server that fetches a URL a stranger supplied is
 * a server-side request forgery: the attacker picks the address and our host
 * makes the connection, from inside whatever network it happens to sit in.
 * "Just checking the link works" is exactly how that hole gets opened.
 *
 * So these functions judge the **shape** of a URL and nothing else. A link that
 * passes is well-formed and points somewhere public; whether anything is there
 * is between the Student and the reader, and the UI says so rather than
 * pretending otherwise.
 *
 * ── Literal addresses are still refused ─────────────────────────────────────
 * We cannot resolve `internal.example.com`, so we do not try. What we *can* do
 * is refuse a host that is already an address in a range nobody should be
 * publishing — loopback, private, link-local, carrier-grade NAT, and the IPv6
 * equivalents. That closes the lazy half of the problem without pretending to
 * close the half that needs DNS.
 */

import {TASK_LIMITS} from './constants';

export type UrlKind = 'github' | 'liveDemo' | 'drive' | 'youtube';

export type UrlCheck =
  | {ok: true; value: string}
  | {ok: false; reason: 'INVALID' | 'NOT_ALLOWED' | 'TOO_LONG'};

const fail = (reason: 'INVALID' | 'NOT_ALLOWED' | 'TOO_LONG'): UrlCheck => ({ok: false, reason});

/**
 * Parse a URL and apply the rules every link shares.
 *
 * HTTPS only — `javascript:`, `data:`, `file:`, and `blob:` are refused here
 * rather than in four separate places, and plain `http:` is refused because a
 * link this product publishes should not downgrade a reader's connection.
 *
 * Credentials in the authority are refused outright: `https://user:pass@host/`
 * is a password in a field somebody will screenshot, and it is also the classic
 * way to make a hostile host look like a familiar one.
 */
function parseCommon(raw: unknown): URL | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > TASK_LIMITS.url.max) return undefined;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }

  if (url.protocol !== 'https:') return undefined;
  if (url.username.length > 0 || url.password.length > 0) return undefined;
  // A port is legitimate but a non-standard one on a "public" link is almost
  // always somebody's development machine.
  if (url.port.length > 0 && url.port !== '443') return undefined;
  if (url.hostname.length === 0) return undefined;

  return url;
}

/** Does this host match a domain, or a subdomain of it? */
function hostMatches(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Addresses that must never be published
// ═══════════════════════════════════════════════════════════════════════════

/** An IPv4 dotted quad, or undefined when the host is not one. */
function asIpv4(hostname: string): number[] | undefined {
  const parts = hostname.split('.');
  if (parts.length !== 4) return undefined;

  const octets = parts.map(part => {
    if (!/^\d{1,3}$/.test(part)) return -1;
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : -1;
  });

  return octets.some(octet => octet < 0) ? undefined : octets;
}

/**
 * True when a literal address belongs to a range that is not on the public
 * internet.
 *
 * Enumerated rather than reduced to a clever bit test, because each line is a
 * decision somebody should be able to read and check against the RFC.
 */
function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 — "this network"
  if (a === 10) return true; // 10/8 — private
  if (a === 127) return true; // 127/8 — loopback
  if (a === 169 && b === 254) return true; // 169.254/16 — link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 — private
  if (a === 192 && b === 168) return true; // 192.168/16 — private
  if (a === 192 && b === 0) return true; // 192.0.0/24 and 192.0.2/24
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 — benchmarking
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 — carrier-grade NAT
  if (a >= 224) return true; // multicast and reserved
  return false;
}

/** True when an IPv6 literal is loopback, link-local, or unique-local. */
function isPrivateIpv6(hostname: string): boolean {
  // A URL keeps IPv6 literals in brackets.
  const address = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (address === '::1' || address === '::') return true;
  if (address.startsWith('fe80:')) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(address)) return true; // fc00::/7 unique-local

  /*
    An IPv4-mapped address is still that IPv4 address, and both spellings have
    to be handled.

    `https://[::ffff:127.0.0.1]/` never reaches here in its readable form: the
    WHATWG URL parser normalises the host to `[::ffff:7f00:1]`, so a check that
    only looked for a dotted quad would miss every mapped address arriving
    through a URL — which is all of them. The hex form is the one that matters;
    the dotted form is kept for callers passing a hostname directly.
  */
  const mappedDotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mappedDotted) {
    const octets = asIpv4(mappedDotted[1]);
    return octets ? isPrivateIpv4(octets) : true;
  }

  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    return isPrivateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }

  return false;
}

/**
 * True when this host is one a public link must never point at.
 *
 * `localhost` is named explicitly: it is not an IP literal, so the numeric
 * checks would miss it, and it is by far the most common thing somebody pastes
 * by accident.
 */
export function isNonPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  // `.local` is mDNS; `.internal` and `.home.arpa` are private by convention.
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) {
    return true;
  }
  if (host.includes(':')) return isPrivateIpv6(host);

  const octets = asIpv4(host);
  if (octets) return isPrivateIpv4(octets);

  // A bare label with no dot is a host on the local network, not the internet.
  return !host.includes('.');
}

// ═══════════════════════════════════════════════════════════════════════════
// The four kinds
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A GitHub link.
 *
 * Any ordinary path is allowed — a repository, a pull request, a tree, a gist.
 * Narrowing it to `/owner/repo` would refuse a Student who submits the exact
 * branch their work is on, which is a more useful link, not a worse one.
 */
export function validateGithubUrl(raw: unknown): UrlCheck {
  const url = parseCommon(raw);
  if (!url) return fail('INVALID');
  if (!hostMatches(url.hostname, 'github.com') && !hostMatches(url.hostname, 'gist.github.com')) {
    return fail('NOT_ALLOWED');
  }
  if (url.pathname.length <= 1) return fail('NOT_ALLOWED');
  return {ok: true, value: url.toString()};
}

/**
 * A live demo.
 *
 * Any public HTTPS host, which is the point — a demo can be anywhere. GitHub
 * Pages (`*.github.io`) is explicitly fine and is where most of these will
 * live; it needs no special case because it is an ordinary public host.
 */
export function validateLiveDemoUrl(raw: unknown): UrlCheck {
  const url = parseCommon(raw);
  if (!url) return fail('INVALID');
  if (isNonPublicHost(url.hostname)) return fail('NOT_ALLOWED');
  return {ok: true, value: url.toString()};
}

/**
 * A Google Drive link.
 *
 * Restricted to Google's own document hosts. Nothing here checks or claims that
 * the file is actually shared — that needs Drive's API and the Student's
 * authorisation, and neither exists in this product. The UI reminds them to make
 * it viewable; this only guarantees the link goes to Drive.
 */
export function validateDriveUrl(raw: unknown): UrlCheck {
  const url = parseCommon(raw);
  if (!url) return fail('INVALID');
  const allowed = ['drive.google.com', 'docs.google.com'];
  if (!allowed.some(domain => url.hostname.toLowerCase() === domain)) return fail('NOT_ALLOWED');
  return {ok: true, value: url.toString()};
}

/**
 * A YouTube video, reduced to its id.
 *
 * Only the id is stored. Keeping the URL would mean storing a tracking query
 * string somebody pasted, and keeping an embed would mean storing provider HTML
 * — which is a script tag waiting for a rendering context. An eleven-character
 * id is the whole of what a player needs.
 *
 * Availability is not checked and cannot be: telling Public from Unlisted from
 * deleted needs YouTube's API. The UI says so rather than implying a guarantee.
 */
export function validateYoutubeUrl(raw: unknown): UrlCheck {
  const url = parseCommon(raw);
  if (!url) return fail('INVALID');

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let id = '';

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (url.pathname === '/watch') {
      id = url.searchParams.get('v') ?? '';
    } else {
      const shorts = /^\/(?:shorts|embed|v)\/([^/?#]+)/.exec(url.pathname);
      id = shorts ? shorts[1] : '';
    }
  } else if (host === 'youtu.be') {
    id = url.pathname.replace(/^\//, '').split('/')[0];
  } else {
    return fail('NOT_ALLOWED');
  }

  // YouTube ids are eleven characters of an unreserved alphabet. Anything else
  // is a playlist, a channel, or something that is not a video.
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return fail('INVALID');
  return {ok: true, value: id};
}

/** Validate one link of a given kind. */
export function validateUrl(kind: UrlKind, raw: unknown): UrlCheck {
  switch (kind) {
    case 'github':
      return validateGithubUrl(raw);
    case 'liveDemo':
      return validateLiveDemoUrl(raw);
    case 'drive':
      return validateDriveUrl(raw);
    case 'youtube':
      return validateYoutubeUrl(raw);
  }
}

/** Which validator belongs to which stored field. */
export const FIELD_URL_KIND: Readonly<Record<string, UrlKind>> = {
  githubUrl: 'github',
  liveDemoUrl: 'liveDemo',
  googleDriveUrl: 'drive',
  youtubeVideoId: 'youtube',
};
