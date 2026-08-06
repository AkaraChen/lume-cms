import packageJson from './package.json';

const exportLimits: Partial<Record<string, string>> = {
  '.': '5 kB',
  './config': '1 kB',
  './schedule': '1 kB',
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
    limit: '5 kB',
  },
  {
    name: 'published runtime total',
    path: ['dist/*.mjs', 'bin/*.mjs'],
    limit: '14 kB',
  },
];
