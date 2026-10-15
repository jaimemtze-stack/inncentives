import { describe, expect, it } from 'vitest';
import { buildSubject, formatTicketNumber, parseTicketNumbers, ticketDayKey } from './number';

describe('ticket numbers', () => {
  it('uses the local day in Mexico City', () => {
    // 2026-10-16 03:00Z is still Oct 15 in Mexico City
    expect(formatTicketNumber(new Date('2026-10-16T03:00:00Z'), 1)).toBe('202610150001');
    expect(formatTicketNumber(new Date('2026-10-16T07:00:00Z'), 42)).toBe('202610160042');
    expect(ticketDayKey(new Date('2026-10-16T03:00:00Z'))).toBe('20261015');
  });
  it('validates the counter', () => {
    expect(() => formatTicketNumber(new Date(), 0)).toThrow();
    expect(() => formatTicketNumber(new Date(), 10000)).toThrow();
    expect(
      formatTicketNumber(new Date('2026-10-15T18:00:00Z'), 10000, 'America/Mexico_City', 5),
    ).toBe('2026101510000');
  });
  it('builds subjects without duplicating the tag or allowing line breaks', () => {
    expect(buildSubject('202610150001', 'Error en cálculo')).toBe(
      '[Ticket#202610150001] Error en cálculo',
    );
    expect(buildSubject('202610150001', 'RE: [Ticket#202610150001] x')).toBe(
      'RE: [Ticket#202610150001] x',
    );
    expect(buildSubject('1', 'a\r\nBcc: x@y.z')).toBe('[Ticket#1] a Bcc: x@y.z');
  });
  it('parses numbers from subjects with a configurable prefix', () => {
    expect(parseTicketNumbers('RE: [Ticket#202610150001] Hola')).toEqual(['202610150001']);
    expect(parseTicketNumbers('[ticket# 202610150001] [Ticket#202610150001]')).toEqual([
      '202610150001',
    ]);
    expect(parseTicketNumbers('Sin número 202610150001')).toEqual([]);
    expect(parseTicketNumbers('[Soporte+202610150001]', 'Soporte+')).toEqual(['202610150001']);
  });
});
