import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';

/** Private, loopback, link-local (cloud metadata), CGNAT, multicast and reserved ranges. */
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return true;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d): judge the embedded IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isBlockedAddress(mapped[1]!);
  if (/^::ffff:/i.test(ip)) return true;
  return blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

export interface SafeResponse {
  status: number;
  body: string;
}

/**
 * HTTPS POST for webhooks with SSRF protection: HTTPS only, every resolved
 * address checked against blocked ranges and the connection pinned to the
 * checked address, no redirects, small timeouts and response cap.
 */
export async function safePost(
  url: string,
  body: string,
  headers: Record<string, string>,
  opts: {
    timeoutMs?: number;
    resolve?: (host: string) => Promise<Array<{ address: string; family: number }>>;
  } = {},
): Promise<SafeResponse> {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Only HTTPS webhooks are allowed');
  if (u.username || u.password) throw new Error('Credentials in URL are not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await (opts.resolve ?? ((h) => lookup(h, { all: true })))(host);
  if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address))) {
    throw new Error('Destination address is not allowed');
  }
  const target = addrs[0]!;
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: target.address,
        family: target.family,
        servername: isIP(host) ? undefined : host,
        port: u.port ? Number(u.port) : 443,
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        headers: { ...headers, host: u.host, 'content-length': Buffer.byteLength(body).toString() },
        timeout: opts.timeoutMs ?? 10_000,
        minVersion: 'TLSv1.2',
      },
      (res) => {
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size <= 16_384) chunks.push(c);
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('Webhook timeout')));
    req.on('error', reject);
    req.end(body);
  });
}
