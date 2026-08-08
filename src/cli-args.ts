import { cli } from 'cleye';

export const CLI_USAGE = 'Usage: lume-cms build [--watch] [--strict]';

export interface CliOptions {
  command: 'build';
  watch: boolean;
  strict: boolean;
}

export function parseCliArgs(argv: string[]): CliOptions {
  // Help:false keeps this pure (no process.exit on --help).
  const parsed = cli(
    {
      name: 'lume-cms',
      parameters: ['[command]'],
      flags: {
        watch: {
          type: Boolean,
          description: 'Watch content files and rebuild on change',
        },
        strict: {
          type: Boolean,
          description: 'Fail the build when content diagnostics are found',
        },
      },
      help: false,
    },
    undefined,
    argv,
  );

  const { command } = parsed._;
  const endOfFlags = parsed._['--'];
  const isInvalid =
    Object.keys(parsed.unknownFlags).length > 0
    || (command !== undefined && command !== 'build')
    || parsed._.length > 1
    || endOfFlags.length > 0;

  if (isInvalid) {
    throw new Error(CLI_USAGE);
  }

  return {
    command: 'build',
    watch: parsed.flags.watch ?? false,
    strict: parsed.flags.strict ?? false,
  };
}
