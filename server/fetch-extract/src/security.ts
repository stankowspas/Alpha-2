import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>;

export interface ValidatedTarget {
  url: URL;
  hostname: string;
  address: ResolvedAddress;
  allAddresses: ResolvedAddress[];
}

export class FetchSecurityError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "FetchSecurityError";
  }
}

const blockedV4 = new BlockList();
const blockedV6 = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
] as const) blockedV4.addSubnet(network, prefix, "ipv4");

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8]
] as const) blockedV6.addSubnet(network, prefix, "ipv6");

const BLOCKED_EXACT_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.amazonaws.com"
]);

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home.arpa"
];

function bareHostname(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) return normalized.slice(1, -1);
  return normalized.replace(/\.$/u, "");
}

export function isBlockedHostname(hostname: string): boolean {
  const host = bareHostname(hostname);
  return BLOCKED_EXACT_HOSTS.has(host)
    || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  if (family === 6) return !blockedV6.check(address, "ipv6");
  return false;
}

export function validateRemoteUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FetchSecurityError("INVALID_URL", "Fetch target не е валиден URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new FetchSecurityError("SCHEME_DENIED", "Разрешени са само HTTP и HTTPS targets.");
  }
  if (url.username || url.password) {
    throw new FetchSecurityError("CREDENTIALS_DENIED", "URL credentials не са разрешени.");
  }
  if (url.port) {
    throw new FetchSecurityError("PORT_DENIED", "Fetch target трябва да използва стандартен HTTP/HTTPS port.");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new FetchSecurityError("HOST_DENIED", "Local/internal hostname не е разрешен.");
  }

  url.hash = "";
  return url;
}

export const systemResolver: ResolveHost = async (hostname) => {
  const host = bareHostname(hostname);
  const literalFamily = isIP(host);
  if (literalFamily === 4 || literalFamily === 6) return [{ address: host, family: literalFamily }];

  const records = await lookup(host, { all: true, verbatim: true });
  const addresses: ResolvedAddress[] = [];
  for (const record of records) {
    if (record.family === 4 || record.family === 6) {
      addresses.push({ address: record.address, family: record.family });
    }
  }
  return addresses;
};

export async function resolvePublicTarget(
  value: string | URL,
  resolver: ResolveHost = systemResolver
): Promise<ValidatedTarget> {
  const url = value instanceof URL ? validateRemoteUrl(value.toString()) : validateRemoteUrl(value);
  const hostname = bareHostname(url.hostname);

  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new FetchSecurityError("DNS_FAILED", "DNS resolution за fetch target не успя.");
  }

  if (addresses.length === 0) throw new FetchSecurityError("DNS_EMPTY", "Fetch target няма A/AAAA адреси.");

  for (const record of addresses) {
    if (!isPublicAddress(record.address)) {
      throw new FetchSecurityError("NON_PUBLIC_IP", "Fetch target се резолва към непублична IP мрежа.");
    }
  }

  return {
    url,
    hostname,
    address: addresses[0],
    allAddresses: addresses
  };
}
