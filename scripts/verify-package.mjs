import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' }));
const files = new Set(packed[0]?.files?.map((file) => file.path));
if (!files.has('bin/lume-cms.mjs')) throw new Error('Published package is missing its stable bin entry');
if (!files.has('dist/cli.mjs')) throw new Error('Published package is missing dist/cli.mjs');
if (!files.has('dist/schedule.mjs') || !files.has('dist/schedule.d.mts')) {
  throw new Error('Published package is missing its schedule entry');
}
if (readFileSync('dist/index.mjs', 'utf8').includes('publishAtMs')) {
  throw new Error('The core runtime bundle statically includes schedule implementation details');
}
const { schedule } = await import('../dist/schedule.mjs');
if (schedule().id !== 'schedule') throw new Error('The published schedule entry is not importable');

const fixture = mkdtempSync(path.join(tmpdir(), 'lume-cms-package-'));
let watchChild;
try {
  mkdirSync(path.join(fixture, 'content'), { recursive: true });
  writeFileSync(path.join(fixture, 'content/page.md'), '---\ntitle: Page\n---\nBody');
  execFileSync(process.execPath, [path.resolve('bin/lume-cms.mjs'), 'build'], { cwd: fixture, stdio: 'pipe' });
  if (!existsSync(path.join(fixture, 'content.generated.json'))) {
    throw new Error('Published CLI did not generate content.generated.json');
  }
  watchChild = spawn(process.execPath, [path.resolve('bin/lume-cms.mjs'), 'build', '--watch'], {
    cwd: fixture,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForOutput(watchChild, /Watching for content and configuration changes\./);
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

console.log('Published CLI artifact, build command, and watch lifecycle verified.');
