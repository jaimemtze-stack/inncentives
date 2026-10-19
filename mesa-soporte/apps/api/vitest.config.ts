import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

// Integration files share one database: run them in name order (00-bootstrap first).
class ByNameSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}

// SWC keeps decorator metadata, which NestJS dependency injection needs.
const plugins = [swc.vite({ module: { type: 'es6' } })];

export default defineConfig({
  test: {
    // Integration tests share one database and one Redis: run files one after another.
    fileParallelism: false,
    sequence: { sequencer: ByNameSequencer },
    projects: [
      {
        plugins,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        plugins,
        test: {
          name: 'integration',
          include: ['test/**/*.int.test.ts'],
          environment: 'node',
          setupFiles: ['test/setup-env.ts'],
          globalSetup: ['test/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
