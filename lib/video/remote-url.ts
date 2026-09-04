import 'server-only'

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * Validation for the "import by pasting a download link" feature.
 *
 * A server that fetches an arbitrary user-supplied URL is a server-side
 * request forgery primitive: the attacker picks the destination and we make
 * the request with our own network position. On a cloud host that reaches the
 * instance metadata endpoint, which hands out credentials.
 *
 * So: scheme allowlist, port allowlist, and — the part that is easy to skip —
 * resolve the hostname and check the *resolved address*, because
 * `http://attacker.com` can legitimately resolve to 127.0.0.1.
 *
 * This still cannot close DNS rebinding on its own (the name can resolve
 * differently when the worker fetches it a moment later). The worker must
 * therefore also pin the address it validated, or run egress-firewalled. See
 * docs/COMPLIANCE.md.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const ALLOWED_PORTS = new Set(['', '80', '443', '8080'])

/** Hostnames that must never be fetched regardless of resolution. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
])

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true

  const [a, b] = parts

  if (a === 0) return true // "this network"
  if (a === 10) return true // RFC1918
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
  if (a === 192 && b === 168) return true // RFC1918
  if (a === 192 && b === 0) return true // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a >= 224) return true // multicast + reserved

  return false
}

function isPrivateIPv6(ip: string): boolean {
  const normalised = ip.toLowerCase().replace(/^\[|\]$/g, '')

  if (normalised === '::' || normalised === '::1') return true
  if (normalised.startsWith('fe80')) return true // link-local
  if (normalised.startsWith('fc') || normalised.startsWith('fd')) return true // ULA

  // IPv4-mapped (::ffff:127.0.0.1) inherits the v4 verdict.
  const mapped = normalised.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIPv4(mapped[1])

  return false
}

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return isPrivateIPv4(ip)
  if (version === 6) return isPrivateIPv6(ip)
  return true // unparseable: refuse
}

export interface ValidatedRemoteUrl {
  url: string
  hostname: string
  /** The address that was actually checked. Pin the fetch to this. */
  resolvedAddress: string
}

/**
 * Throws UnsafeUrlError unless the URL is safe for the worker to fetch.
 * Call this before writing anything to ingest_jobs.source_url.
 */
export async function validateRemoteUrl(raw: string): Promise<ValidatedRemoteUrl> {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    throw new UnsafeUrlError('That is not a valid URL.')
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new UnsafeUrlError('Only http:// and https:// links can be imported.')
  }

  if (!ALLOWED_PORTS.has(parsed.port)) {
    throw new UnsafeUrlError('That port is not allowed for imports.')
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    throw new UnsafeUrlError('That host cannot be imported from.')
  }

  if (parsed.username || parsed.password) {
    throw new UnsafeUrlError('Links with embedded credentials are not accepted.')
  }

  // A literal address needs no lookup; a name does.
  let resolvedAddress: string

  if (isIP(hostname)) {
    resolvedAddress = hostname
  } else {
    try {
      const result = await lookup(hostname)
      resolvedAddress = result.address
    } catch {
      throw new UnsafeUrlError('That host could not be resolved.')
    }
  }

  if (isPrivateAddress(resolvedAddress)) {
    throw new UnsafeUrlError('That host resolves to a private address.')
  }

  return { url: parsed.toString(), hostname, resolvedAddress }
}

/**
 * Cheap pre-flight so the uploader gets an error in the form rather than a
 * failed job ten minutes later. HEAD is advisory — plenty of CDNs refuse it,
 * so a non-OK response is not treated as fatal.
 */
export async function probeRemoteUrl(url: string): Promise<{
  contentType: string | null
  contentLength: number | null
}> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    })

    return {
      contentType: response.headers.get('content-type'),
      contentLength: Number(response.headers.get('content-length')) || null,
    }
  } catch {
    return { contentType: null, contentLength: null }
  }
}
