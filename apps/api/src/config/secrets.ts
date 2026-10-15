import { readFile } from 'node:fs/promises';

/**
 * Secrets are never read from the repository. Resolution order for a secret NAME:
 * 1. Key Vault (when SECRETS_PROVIDER=keyvault), secret name NAME with "_" → "-".
 * 2. File at NAME_FILE (Docker secrets / mounted volume).
 * 3. Environment variable NAME (local development only).
 */
export interface SecretsProvider {
  get(name: string): Promise<string | undefined>;
}

export class EnvFileSecretsProvider implements SecretsProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async get(name: string): Promise<string | undefined> {
    const file = this.env[`${name}_FILE`];
    if (file) return (await readFile(file, 'utf8')).trim();
    return this.env[name];
  }
}

/** Azure Key Vault with Managed Identity (DefaultAzureCredential, no shared keys). */
export class KeyVaultSecretsProvider implements SecretsProvider {
  private client: { getSecret(name: string): Promise<{ value?: string }> } | undefined;

  constructor(
    private readonly vaultUrl: string,
    private readonly fallback: SecretsProvider,
  ) {}

  private async getClient() {
    if (!this.client) {
      const { DefaultAzureCredential } = await import('@azure/identity');
      const { SecretClient } = await import('@azure/keyvault-secrets');
      this.client = new SecretClient(this.vaultUrl, new DefaultAzureCredential());
    }
    return this.client;
  }

  async get(name: string): Promise<string | undefined> {
    try {
      const client = await this.getClient();
      const s = await client.getSecret(name.toLowerCase().replace(/_/g, '-'));
      if (s.value) return s.value;
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 404) throw err;
    }
    return this.fallback.get(name);
  }
}

export function createSecretsProvider(env: NodeJS.ProcessEnv = process.env): SecretsProvider {
  const base = new EnvFileSecretsProvider(env);
  if (env.SECRETS_PROVIDER === 'keyvault') {
    if (!env.KEYVAULT_URL)
      throw new Error('KEYVAULT_URL is required when SECRETS_PROVIDER=keyvault');
    return new KeyVaultSecretsProvider(env.KEYVAULT_URL, base);
  }
  return base;
}
