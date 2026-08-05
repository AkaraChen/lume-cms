import packageJson from './package.json';

const exportLimits: Partial<Record<string, string>> = {
  '.': '2.7 kB',
  './config': '500 B',
  './schedule': '750 B',
};

function hasImport(target: unknown): target is { import: string } {
  return typeof target === 'object'
    && target !== null
    && 'import' in target
    && typeof target.import === 'string';
}

const exportChecks = Object.entries(packageJson.exports).flatMap(([subpath, target]) => {
  if (!hasImport(target)) return [];
  const limit = exportLimits[subpath];
  if (!limit) throw new Error(`Missing size limit for package export ${JSON.stringify(subpath)}`);

  return [{
    name: `export ${subpath} (${target.import})`,
    path: target.import.replace(/^\.\//, ''),
    limit,
  }];
});

export default [
  ...exportChecks,
  {
    name: 'cli (dist/cli.mjs)',
    path: 'dist/cli.mjs',
    limit: '7.2 kB',
  },
  {
    name: 'published runtime total',
    path: ['dist/*.mjs', 'bin/*.mjs'],
    limit: '12.2 kB',
  },
];
