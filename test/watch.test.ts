import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WatchBuildResult } from '../src/watch.js';
import { watchContent } from '../src/watch.js';

const dirs: string[] = [];

async function fixture() {
  const cwd = await mkdtemp(path.join(tmpdir(), 'lume-cms-watch-'));
  dirs.push(cwd);
  await mkdir(path.join(cwd, 'content'), { recursive: true });
  await writeFile(path.join(cwd, 'content/a.md'), '---\ntitle: A\n---\nA');
  await writeFile(path.join(cwd, 'content/b.md'), '---\ntitle: B\n---\nB');
  await writeFile(path.join(cwd, 'plugin.ts'), `export default {
  id: 'probe',
  compile: { cacheKey: 'v1', entry() { return { version: 'v1' }; } },
};
`);
  await writeFile(path.join(cwd, 'lume.config.ts'), `import plugin from './plugin';
export default { collections: { default: { include: ['content/**/*.md'] } }, plugins: [plugin] };
`);
  return cwd;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('watchContent', () => {
  it('handles add, change, rename, delete, config/plugin invalidation, errors, and close', async () => {
    const cwd = await fixture();
    const builds: WatchBuildResult[] = [];
    const errors: unknown[] = [];
    const watcher = await watchContent({
      cwd,
      debounceMs: 10,
      onBuild: (result) => { builds.push(result); },
      onError: (error) => { errors.push(error); },
    });

    expect(builds).toHaveLength(1);
    expect(builds[0]?.stats).toEqual({ compiledEntries: 2, cachedEntries: 0 });

    async function nextBuild(
      after: number,
      predicate: (result: WatchBuildResult) => boolean,
    ): Promise<WatchBuildResult> {
      let match: WatchBuildResult | undefined;
      await vi.waitFor(() => {
        match = builds.slice(after).find(predicate);
        expect(match).toBeDefined();
      });
      return match!;
    }

    let previousBuilds = builds.length;
    await writeFile(path.join(cwd, 'content/a.md'), '---\ntitle: A2\n---\nA2');
    const changed = await nextBuild(previousBuilds, (result) => (
      result.content.collections.default?.entries[0]?.data.title === 'A2'
    ));
    expect(changed.stats).toEqual({ compiledEntries: 1, cachedEntries: 1 });

    previousBuilds = builds.length;
    await rename(path.join(cwd, 'content/b.md'), path.join(cwd, 'content/c.md'));
    const renamed = await nextBuild(previousBuilds, (result) => (
      result.content.collections.default?.entries.map((item) => item.slug.join('/')).join(',') === 'a,c'
    ));
    expect(renamed.stats).toEqual({ compiledEntries: 1, cachedEntries: 1 });

    previousBuilds = builds.length;
    await rm(path.join(cwd, 'content/c.md'));
    const deleted = await nextBuild(previousBuilds, (result) => (
      result.content.collections.default?.entries.length === 1
    ));
    expect(deleted.stats).toEqual({ compiledEntries: 0, cachedEntries: 1 });

    previousBuilds = builds.length;
    await writeFile(path.join(cwd, 'content/d.md'), '---\ntitle: D\n---\nD');
    const added = await nextBuild(previousBuilds, (result) => (
      result.content.collections.default?.entries.map((item) => item.slug.join('/')).join(',') === 'a,d'
    ));
    expect(added.stats).toEqual({ compiledEntries: 1, cachedEntries: 1 });

    const previousErrors = errors.length;
    await writeFile(path.join(cwd, 'content/a.md'), '---\ntitle: [\n---\nbroken');
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(previousErrors));
    previousBuilds = builds.length;
    await writeFile(path.join(cwd, 'content/a.md'), '---\ntitle: Recovered\n---\nRecovered');
    await nextBuild(previousBuilds, (result) => (
      result.content.collections.default?.entries[0]?.data.title === 'Recovered'
    ));

    previousBuilds = builds.length;
    await writeFile(path.join(cwd, 'plugin.ts'), `export default {
  id: 'probe',
  compile: { cacheKey: 'v2', entry() { return { version: 'v2' }; } },
};
`);
    const changedPlugin = await nextBuild(previousBuilds, (result) => result.content.collections.default!.entries.every(
      (item) => (item.ext.probe as { version: string }).version === 'v2',
    ));
    expect(changedPlugin.stats).toEqual({ compiledEntries: 2, cachedEntries: 0 });

    previousBuilds = builds.length;
    await writeFile(path.join(cwd, 'lume.config.ts'), `import plugin from './plugin';
export default { collections: { default: { include: ['content/a.md'] } }, plugins: [plugin] };
`);
    const changedConfig = await nextBuild(previousBuilds, (result) => (
      result.content.collections.default?.entries.length === 1
    ));
    expect(changedConfig.stats).toEqual({ compiledEntries: 1, cachedEntries: 0 });

    const output = JSON.parse(await readFile(path.join(cwd, 'content.generated.json'), 'utf8'));
    expect(output.collections.default.entries).toHaveLength(1);
    await watcher.close();
    const completedBuilds = builds.length;
    await writeFile(path.join(cwd, 'content/a.md'), '---\ntitle: Closed\n---\nClosed');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(builds).toHaveLength(completedBuilds);
  });

  it('rebuilds when a collection root outside cwd changes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lume-cms-watch-external-'));
    dirs.push(root);
    const cwd = path.join(root, 'site');
    const shared = path.join(root, 'shared');
    await mkdir(cwd, { recursive: true });
    await mkdir(shared, { recursive: true });
    await writeFile(path.join(shared, 'page.md'), '---\ntitle: Before\n---\nBefore');
    await writeFile(path.join(cwd, 'lume.config.ts'), `export default {
  collections: { default: { root: '../shared', include: ['../shared/**/*.md'] } },
};
`);

    const builds: WatchBuildResult[] = [];
    const watcher = await watchContent({
      cwd,
      debounceMs: 10,
      onBuild: (result) => { builds.push(result); },
    });
    expect(builds.at(-1)?.content.collections.default?.entries[0]?.data.title).toBe('Before');

    const previousBuilds = builds.length;
    await writeFile(path.join(shared, 'page.md'), '---\ntitle: After\n---\nAfter');
    await vi.waitFor(() => {
      expect(builds.slice(previousBuilds).some((result) => (
        result.content.collections.default?.entries[0]?.data.title === 'After'
      ))).toBe(true);
    });
    await watcher.close();
  });
});
