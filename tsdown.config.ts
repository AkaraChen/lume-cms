import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/fumadocs.ts',
    config: 'src/config.ts',
    cli: 'src/cli.ts',
  },
  dts: true,
  clean: true,
  format: 'esm',
  platform: 'node',
});
