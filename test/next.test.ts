import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLume, type NextConfigExport } from '../src/next.js';
import { watchContent } from '../src/watch.js';

vi.mock('../src/watch.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/watch.js')>(),
  watchContent: vi.fn(),
}));

const dirs: string[] = [];

function configFunction(config: NextConfigExport) {
  if (typeof config !== 'function') throw new TypeError('Expected a Next.js config function');
  return config;
}

async function fixture() {
  const cwd = await mkdtemp(path.join(tmpdir(), 'lume-cms-next-'));
  dirs.push(cwd);
  await mkdir(path.join(cwd, 'content'));
  await writeFile(path.join(cwd, 'content', 'page.md'), '---\ntitle: Page\n---\nBody');
  return cwd;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Next.js plugin', () => {
  it('compiles before a production build and composes an async config function', async () => {
    const cwd = await fixture();
    const base = vi.fn(async (phase: string) => ({ phase, reactStrictMode: true }));
    const configured = configFunction(createLume({ cwd })(base));

    await expect(configured('phase-production-build', { defaultConfig: {} }))
      .resolves.toEqual({ phase: 'phase-production-build', reactStrictMode: true });
    const output = JSON.parse(await readFile(path.join(cwd, 'content.generated.json'), 'utf8'));
    expect(output.collections.default.entries[0].data.title).toBe('Page');
    expect(base).toHaveBeenCalledOnce();
  });

  it('starts one development watcher and leaves unrelated Next.js phases alone', async () => {
    const cwd = await fixture();
    const close = vi.fn();
    vi.mocked(watchContent).mockResolvedValue({ rebuild: vi.fn(), close });
    const configured = configFunction(createLume({ cwd, strict: true })({ reactStrictMode: true }));

    await expect(configured('phase-development-server', { defaultConfig: {} }))
      .resolves.toEqual({ reactStrictMode: true });
    await configured('phase-development-server', { defaultConfig: {} });
    expect(watchContent).toHaveBeenCalledOnce();
    expect(watchContent).toHaveBeenCalledWith(expect.objectContaining({ cwd, strict: true }));

    const otherCwd = await fixture();
    const other = configFunction(createLume({ cwd: otherCwd })({}));
    await other('phase-production-server', { defaultConfig: {} });
    expect(watchContent).toHaveBeenCalledOnce();
  });
});
