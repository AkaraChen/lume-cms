import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' }));
const files = new Set(packed[0]?.files?.map((file) => file.path));
if (!files.has('bin/lume-cms.mjs')) throw new Error('Published package is missing its stable bin entry');
if (!files.has('dist/cli.mjs')) throw new Error('Published package is missing dist/cli.mjs');

const fixture = mkdtempSync(path.join(tmpdir(), 'lume-cms-package-'));
try {
  mkdirSync(path.join(fixture, 'content'), { recursive: true });
  writeFileSync(path.join(fixture, 'content/page.md'), '---\ntitle: Page\n---\nBody');
  execFileSync(process.execPath, [path.resolve('bin/lume-cms.mjs'), 'build'], { cwd: fixture, stdio: 'pipe' });
  if (!existsSync(path.join(fixture, 'content.generated.json'))) {
    throw new Error('Published CLI did not generate content.generated.json');
  }
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log('Published CLI artifact and build command verified.');
