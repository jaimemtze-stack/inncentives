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
  /** OIDC providers. The client secret is a secret file named by secretName. */
  sso_providers: [] as Array<{
    id: string;
    label: string;
    area: 'agent' | 'portal';
    issuer: string;
    clientId: string;
    secretName: string;
    scopes: string;
    /** Skip our TOTP/WebAuthn when the IdP reports MFA in "amr" (e.g. Entra ID with Conditional Access). */
    trustIdpMfa: boolean;
  }>,
  azure_devops: {
    organization: '',
    project: '',
    defaultType: 'Bug',
    secretName: 'azure_devops_pat',
  } as {
    organization: string;
    project: string;
    defaultType: string;
    secretName: string;
  },
  /**
   * Inncentives API (phase 3). "off" until the API exists; "mock" serves
   * demo data (development only); "http" calls baseUrl with the API token.
   */
  inncentives: {
    mode: 'off',
    baseUrl: '',
    secretName: 'inncentives_api_token',
    widgetSecretName: 'inncentives_widget_secret',
    widgetIssuer: 'inncentives',
  } as {
    mode: 'off' | 'mock' | 'http';
    baseUrl: string;
    secretName: string;
    widgetSecretName: string;
    widgetIssuer: string;
  },
  /** WhatsApp Business (Meta Cloud API) and SMS (Twilio). Credentials are secret files. */
  messaging: { whatsappApiVersion: 'v21.0', twilioAccountSid: '', reopenDays: 7 } as {
    whatsappApiVersion: string;
    twilioAccountSid: string;
    /** A new message joins the contact's open ticket of the same channel updated within these days. */
    reopenDays: number;
  },
  chat: {
    enabled: false,
    groupId: '00000000-0000-4000-8000-000000000301',
    idleMinutes: 15,
  } as { enabled: boolean; groupId: string; idleMinutes: number },
  /** AI suggestions (section 5.12): off globally and per organization by default. */
  ai: {
    enabled: false,
    model: 'claude-opus-5-5',
    secretName: 'anthropic_api_key',
  } as { enabled: boolean; model: string; secretName: string },
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
