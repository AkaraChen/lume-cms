import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' }));
const files = new Set(packed[0]?.files?.map((file) => file.path));
if (!files.has('dist/cli.mjs')) throw new Error('Published package is missing dist/cli.mjs');

const fixture = mkdtempSync(path.join(tmpdir(), 'lume-cms-package-'));
try {
  let emptyScanFailed = false;
  try {
    execFileSync(process.execPath, ['dist/cli.mjs', 'scan-client', fixture, 'UNPUBLISHED_SENTINEL'], {
      stdio: 'pipe',
    });
  } catch (error) {
    emptyScanFailed = (error.stderr?.toString() ?? '').includes('Scanned 0 files');
  }
  if (!emptyScanFailed) throw new Error('Published scan-client CLI did not fail closed on an empty bundle');

  mkdirSync(path.join(fixture, '.next/static/chunks'), { recursive: true });
  writeFileSync(path.join(fixture, '.next/static/chunks/app.js'), 'public-content');
  execFileSync(process.execPath, ['dist/cli.mjs', 'scan-client', fixture, 'UNPUBLISHED_SENTINEL'], {
    stdio: 'pipe',
  });
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log('Published CLI artifact and scan-client command verified.');
