import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

function waitForOutput(child, pattern, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${pattern}; output:\n${output}`));
    }, timeoutMs);
    const onData = (chunk) => {
      output += chunk;
      if (pattern.test(output)) {
        cleanup();
        resolve(output);
      }
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`Watch CLI exited before ${pattern} (code ${code}, signal ${signal}); output:\n${output}`));
    };
    function cleanup() {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
    }
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', onExit);
  });
}

function waitForExit(child, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out stopping watch CLI')), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Watch CLI stopped with code ${code} and signal ${signal}`));
    });
  });
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
if (manifest.peerDependencies?.zod === undefined || manifest.dependencies?.zod !== undefined) {
  throw new Error('Zod must be published as a peer dependency');
}
if (manifest.dependencies?.valibot !== undefined) {
  throw new Error('Valibot must stay a dev-only dependency; schedule validates with the Zod peer');
}
if (manifest.dependencies?.c12 === undefined) {
  throw new Error('c12 must be published as a regular dependency');
}

const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' }));
const files = new Set(packed[0]?.files?.map((file) => file.path));
if (!files.has('bin/lume-cms.mjs')) throw new Error('Published package is missing its stable bin entry');
if (!files.has('dist/cli.mjs')) throw new Error('Published package is missing dist/cli.mjs');
if (!files.has('dist/schedule.mjs') || !files.has('dist/schedule.d.mts')) {
  throw new Error('Published package is missing its schedule entry');
}
const runtimeBundle = readFileSync('dist/index.mjs', 'utf8');
const configBundle = readFileSync('dist/config.mjs', 'utf8');
const publishedBundles = readdirSync('dist')
  .filter((file) => file.endsWith('.mjs'))
  .map((file) => readFileSync(path.join('dist', file), 'utf8'));
if (runtimeBundle.includes('publishAtMs')) {
  throw new Error('The core runtime bundle statically includes schedule implementation details');
}
if (!/from ["']zod["']/.test(configBundle)) {
  throw new Error('The config entry must keep Zod external');
}
if (!publishedBundles.some((bundle) => /from ["']zod\/mini["']/.test(bundle))) {
  throw new Error('The published chunks must keep Zod Mini external');
}
if (!publishedBundles.some((bundle) => /from ["']c12["']/.test(bundle))) {
  throw new Error('The published CLI chunks must keep c12 external');
}
execFileSync('pnpm', [
  'exec',
  'tsc',
  '--noEmit',
  '--strict',
  '--skipLibCheck',
  '--target',
  'ES2022',
  '--module',
  'NodeNext',
  '--moduleResolution',
  'NodeNext',
  'scripts/verify-package-types.ts',
], { stdio: 'pipe' });
const { schedule } = await import('../dist/schedule.mjs');
if (schedule().id !== 'schedule') throw new Error('The published schedule entry is not importable');
const configModule = await import('../dist/config.mjs');
const {
  defaultMetaSchema,
  defaultPageSchema,
  defineI18n,
  officialMetaSchema,
  officialPageSchema,
} = configModule;
if ('composeOnion' in configModule) throw new Error('The internal middleware composer is publicly exported');
if (!defaultPageSchema.safeParse({ title: 'Page', tags: ['docs'] }).success) {
  throw new Error('The published default page schema is not importable');
}
if (!defaultMetaSchema.safeParse({ title: 'Docs', pages: ['index'] }).success) {
  throw new Error('The published default meta schema is not importable');
}
if (officialPageSchema === undefined || officialMetaSchema === undefined) {
  throw new Error('The published official Fumadocs schema baselines are missing');
}
const i18n = defineI18n({ languages: ['en', 'zh'], defaultLanguage: 'en', parser: 'dot' });
if (i18n.defaultLanguage !== 'en' || typeof i18n.translations !== 'function') {
  throw new Error('The published defineI18n export is not usable');
}

const fixture = mkdtempSync(path.join(tmpdir(), 'lume-cms-package-'));
let watchChild;
try {
  mkdirSync(path.join(fixture, 'content'), { recursive: true });
  writeFileSync(path.join(fixture, 'content/page.md'), '---\ntitle: Page\n---\nBody');
  execFileSync(process.execPath, [path.resolve('bin/lume-cms.mjs'), 'build'], { cwd: fixture, stdio: 'pipe' });
  if (!existsSync(path.join(fixture, 'content.generated.json'))) {
    throw new Error('Published CLI did not generate content.generated.json');
  }
  writeFileSync(path.join(fixture, 'content/page.md'), '---\ntitle: Page\n---\n[Missing](./missing)');
  const warningBuild = spawnSync(process.execPath, [path.resolve('bin/lume-cms.mjs'), 'build'], {
    cwd: fixture,
    encoding: 'utf8',
  });
  if (warningBuild.status !== 0 || !warningBuild.stderr.includes('"type":"lume-cms-diagnostic"')) {
    throw new Error(`Non-strict build did not emit a structured warning:\n${warningBuild.stderr}`);
  }
  const strictBuild = spawnSync(process.execPath, [path.resolve('bin/lume-cms.mjs'), 'build', '--strict'], {
    cwd: fixture,
    encoding: 'utf8',
  });
  if (strictBuild.status === 0 || !strictBuild.stderr.includes('Content reference validation failed')) {
    throw new Error(`Strict build did not fail with reference diagnostics:\n${strictBuild.stderr}`);
  }
  writeFileSync(path.join(fixture, 'content/page.md'), '---\ntitle: Page\n---\nBody');
  watchChild = spawn(process.execPath, [path.resolve('bin/lume-cms.mjs'), 'build', '--watch'], {
    cwd: fixture,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForOutput(watchChild, /Watching for content changes\./);
  const rebuilt = waitForOutput(watchChild, /\(1 rebuilt, 0 cached\)/);
  writeFileSync(path.join(fixture, 'content/page.md'), '---\ntitle: Changed\n---\nChanged');
  await rebuilt;
  const exited = waitForExit(watchChild);
  watchChild.kill('SIGTERM');
  await exited;
} finally {
  if (watchChild && watchChild.exitCode === null && watchChild.signalCode === null) {
    const killed = new Promise((resolve) => watchChild.once('exit', resolve));
    watchChild.kill('SIGKILL');
    await killed;
  }
  rmSync(fixture, { recursive: true, force: true });
}

console.log('Published CLI build, strict diagnostics, and watch lifecycle verified.');
