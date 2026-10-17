import { connect } from 'node:net';

export type ClamResult = { status: 'clean' } | { status: 'infected'; signature: string };

/**
 * Minimal clamd client (INSTREAM over TCP). Sends the file in chunks and
 * returns the verdict; any protocol or size error rejects.
 */
export function clamScan(
  host: string,
  port: number,
  data: Buffer,
  timeoutMs = 60_000,
): Promise<ClamResult> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const chunks: Buffer[] = [];
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('clamd timeout')));
    socket.on('error', reject);
    socket.on('data', (c) => chunks.push(c));
    socket.on('end', () => {
      const reply = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim();
      // "stream: OK" | "stream: Eicar-Signature FOUND" | "INSTREAM size limit exceeded. ERROR"
      if (/^stream: OK$/.test(reply)) return resolve({ status: 'clean' });
      const found = /^stream: (.+) FOUND$/.exec(reply);
      if (found) return resolve({ status: 'infected', signature: found[1]!.slice(0, 150) });
      reject(new Error(`clamd: ${reply.slice(0, 200)}`));
    });
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      const size = Buffer.alloc(4);
      for (let i = 0; i < data.length; i += 64 * 1024) {
        const part = data.subarray(i, i + 64 * 1024);
        size.writeUInt32BE(part.length, 0);
        socket.write(Buffer.from(size));
        socket.write(part);
      }
      size.writeUInt32BE(0, 0);
      socket.write(size);
    });
  });
}
