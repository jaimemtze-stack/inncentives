import { describe, expect, it } from 'vitest';
import { isBlockedAddress, safePost } from './safe-fetch';

describe('safePost', () => {
  it('blocks private, loopback and metadata addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '169.254.169.254',
      '192.168.0.1',
      '::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '100.100.1.1',
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('2606:4700::1111')).toBe(false);
  });

  it('refuses http, credentials and hosts resolving to internal ranges', async () => {
    await expect(safePost('http://example.com/x', '{}', {})).rejects.toThrow(/HTTPS/);
    await expect(safePost('https://u:p@example.com/x', '{}', {})).rejects.toThrow(/Credentials/);
    await expect(safePost('https://169.254.169.254/latest', '{}', {})).rejects.toThrow(
      /not allowed/,
    );
    const resolve = async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ];
    await expect(safePost('https://rebind.example/x', '{}', {}, { resolve })).rejects.toThrow(
      /not allowed/,
    );
  });
});
