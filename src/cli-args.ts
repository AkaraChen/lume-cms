import { parseArgs } from 'node:util';

export const CLI_USAGE = 'Usage: lume-cms build [--watch] [--strict]';

export interface CliOptions {
  command: 'build';
  watch: boolean;
  strict: boolean;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const parsed = (() => {
    try {
      return parseArgs({
        args: argv,
        options: {
          watch: { type: 'boolean' },
          strict: { type: 'boolean' },
        },
        allowPositionals: true,
        strict: true,
        tokens: true,
      });
    } catch {
      throw new Error(CLI_USAGE);
    }
  })();

  const seenOptions = new Set<string>();
  for (const token of parsed.tokens) {
    if (token.kind !== 'option') continue;
    if (seenOptions.has(token.name)) throw new Error(CLI_USAGE);
    seenOptions.add(token.name);
  }

  if (
    parsed.positionals.length > 1
    || (parsed.positionals.length === 1 && parsed.positionals[0] !== 'build')
  ) {
    throw new Error(CLI_USAGE);
  }

  return {
    command: 'build',
    watch: parsed.values.watch ?? false,
    strict: parsed.values.strict ?? false,
  };
}
