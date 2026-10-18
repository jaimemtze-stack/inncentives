import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Typed defaults; a missing or malformed row falls back to these values. */
export const SettingDefaults = {
  ticket_hook: 'Ticket#',
  time_accounting: { enabled: true, required: false } as { enabled: boolean; required: boolean },
  customer_can_close: true,
  auto_reply_limit_per_hour: 5,
  portal_group_id: '00000000-0000-4000-8000-000000000301',
  privacy_notice: { es: '', en: '' } as { es: string; en: string },
  default_locale: 'es-MX',
  branding: { productName: 'Soporte Inncentives', primaryColor: '#1d4ed8' } as {
    productName: string;
    primaryColor: string;
  },
};
export type SettingKey = keyof typeof SettingDefaults;

const TTL_MS = 15_000;

/** Application settings stored in app_settings, cached briefly per process. */
@Injectable()
export class SettingsService {
  private cache = new Map<string, { value: unknown; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async get<K extends SettingKey>(key: K): Promise<(typeof SettingDefaults)[K]> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value as (typeof SettingDefaults)[K];
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    const fallback = SettingDefaults[key];
    const value =
      row && typeof row.value === typeof fallback && row.value !== null ? row.value : fallback;
    this.cache.set(key, { value, at: Date.now() });
    return value as (typeof SettingDefaults)[K];
  }

  async all(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(SettingDefaults) as SettingKey[]) out[key] = await this.get(key);
    return out;
  }

  async set<K extends SettingKey>(key: K, value: (typeof SettingDefaults)[K]): Promise<void> {
    const json = value as unknown as Prisma.InputJsonValue;
    await this.prisma.appSetting.upsert({
      where: { key },
      create: { key, value: json },
      update: { value: json },
    });
    this.cache.delete(key);
  }
}
