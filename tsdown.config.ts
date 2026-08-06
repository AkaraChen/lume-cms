import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    config: 'src/config.ts',
    schedule: 'src/schedule.ts',
    cli: 'src/cli.ts',
  },
  dts: true,
  clean: true,
  format: 'esm',
  platform: 'node',
});
