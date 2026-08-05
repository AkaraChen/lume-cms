import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanClientBundle } from '../src/scan-client.js';

const fixtures: string[] = [];

async function fixture(contents?: string) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'lume-cms-scan-'));
  fixtures.push(cwd);
  if (contents !== undefined) {
    const chunks = path.join(cwd, '.next/static/chunks');
    await mkdir(chunks, { recursive: true });
    await writeFile(path.join(chunks, 'app.js'), contents);
  }
  return cwd;
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true })));
});

describe('scanClientBundle', () => {
  it('fails closed when the app has no client bundle files', async () => {
    await expect(scanClientBundle(await fixture(), ['secret'])).rejects.toThrow(/Scanned 0 files/);
  });

  it('reports leaked markers and succeeds only after scanning files', async () => {
    await expect(scanClientBundle(await fixture('contains FUTURE_BODY'), ['FUTURE_BODY']))
      .rejects.toThrow(/Unpublished marker found/);
    await expect(scanClientBundle(await fixture('public only'), ['FUTURE_BODY'])).resolves.toBe(1);
  });
});
