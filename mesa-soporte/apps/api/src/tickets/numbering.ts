import type { Prisma } from '@prisma/client';
import { zonedParts } from '../sla/calendar';

/**
 * Ticket numbers: YYYYMMDD (Mexico City) + a 4-digit daily sequence that
 * grows past 9999 when needed. The counter row is updated atomically inside
 * the creating transaction, so numbers are unique and gap-free per day.
 */
export async function nextTicketNumber(
  tx: Prisma.TransactionClient,
  now = new Date(),
): Promise<string> {
  const p = zonedParts(now, 'America/Mexico_City');
  const day = `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
  const rows = await tx.$queryRaw<Array<{ value: number }>>`
    INSERT INTO ticket_counters (day, value) VALUES (${day}, 1)
    ON CONFLICT (day) DO UPDATE SET value = ticket_counters.value + 1
    RETURNING value`;
  return `${day}${String(rows[0]!.value).padStart(4, '0')}`;
}
