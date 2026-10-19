import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Secrets are read from files (Docker secrets / tmpfs written by secrets-sync).
 * In production a secret can never come from an environment variable; in
 * development and tests the env var `SECRET_<NAME>` is accepted as a fallback.
 */
export class FileSecretsProvider {
  constructor(
    private readonly dir: string,
    private readonly allowEnvFallback: boolean,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  get(name: string): string | undefined {
    if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Invalid secret name: ${name}`);
    const path = join(this.dir, name);
    try {
      const st = statSync(path);
      if ((st.mode & 0o004) !== 0) {
        throw new Error(`Secret file ${path} is world-readable; expected mode 0400 or 0440`);
      }
      const value = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
      // Placeholder written by the bootstrap for integrations not set up yet.
      return value === 'unused' || value === '' ? undefined : value;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    if (this.allowEnvFallback) return this.env[`SECRET_${name.toUpperCase()}`];
    return undefined;
  }

  require(name: string): string {
    const value = this.get(name);
    if (value === undefined || value === '') throw new Error(`Missing required secret: ${name}`);
    return value;
  }
}
