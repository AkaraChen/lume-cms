import { describe, expect, it } from 'vitest';
import { CLI_USAGE, parseCliArguments } from '../src/cli-arguments.js';

describe('parseCliArguments', () => {
  it.each([
    { argv: [], expected: { command: 'build', watch: false, strict: false } },
    { argv: ['build'], expected: { command: 'build', watch: false, strict: false } },
    { argv: ['build', '--watch'], expected: { command: 'build', watch: true, strict: false } },
    { argv: ['build', '--strict'], expected: { command: 'build', watch: false, strict: true } },
    { argv: ['build', '--watch', '--strict'], expected: { command: 'build', watch: true, strict: true } },
    { argv: ['--watch', 'build'], expected: { command: 'build', watch: true, strict: false } },
    { argv: ['build', '--'], expected: { command: 'build', watch: false, strict: false } },
    // cleye/type-flag accept boolean values and last-wins duplicates
    { argv: ['build', '--watch=true'], expected: { command: 'build', watch: true, strict: false } },
    { argv: ['build', '--watch=false'], expected: { command: 'build', watch: false, strict: false } },
    { argv: ['build', '--watch', '--watch'], expected: { command: 'build', watch: true, strict: false } },
    { argv: ['build', '--strict', '--strict'], expected: { command: 'build', watch: false, strict: true } },
  ])('parses $argv', ({ argv, expected }) => {
    expect(parseCliArguments(argv)).toEqual(expected);
  });

  it.each([
    ['serve'],
    ['build', 'extra'],
    ['build', '--nope'],
    ['build', '-w'],
    ['build', '--', 'x'],
  ])('rejects invalid arguments: %j', (...argv) => {
    expect(() => parseCliArguments(argv)).toThrowError(new Error(CLI_USAGE));
  });

  it('does not expose parser error details', () => {
    try {
      parseCliArguments(['build', '--nope']);
      expect.unreachable('expected parsing to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(CLI_USAGE);
      expect((error as Error).message).not.toMatch(/ERR_PARSE_ARGS|Unknown flag|Did you mean/);
    }
  });
});
