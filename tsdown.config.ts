import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    compile: 'src/compile.ts',
    config: 'src/config.ts',
    fumadocs: 'src/fumadocs.ts',
    unsafe: 'src/unsafe.ts',
    cli: 'src/cli.ts',
  },
  dts: true,
  clean: true,
  format: 'esm',
  platform: 'node',
});
