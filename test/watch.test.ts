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
  const configModule = new URL('../src/config.ts', import.meta.url).pathname;
  await writeFile(path.join(cwd, 'plugin.ts'), `import { defineBuildPlugin } from ${JSON.stringify(configModule)};
export default defineBuildPlugin({
  id: 'probe',
  build: { cacheKey: 'v1', entry() { return { version: 'v1' }; } },
});
`);
  await writeFile(path.join(cwd, 'lume.config.ts'), `import plugin from './plugin';
export default { collections: { default: { include: ['**/*.md'], plugins: [plugin] } } };
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
    const configModule = new URL('../src/config.ts', import.meta.url).pathname;
    await writeFile(path.join(cwd, 'plugin.ts'), `import { defineBuildPlugin } from ${JSON.stringify(configModule)};
export default defineBuildPlugin({
  id: 'probe',
  build: { cacheKey: 'v2', entry() { return { version: 'v2' }; } },
});
`);
    const changedPlugin = await nextBuild(previousBuilds, (result) => result.content.collections.default!.entries.every(
      (item) => (item.ext.probe as { version: string }).version === 'v2',
    ));
    expect(changedPlugin.stats).toEqual({ compiledEntries: 2, cachedEntries: 0 });

    previousBuilds = builds.length;
    await writeFile(path.join(cwd, 'lume.config.ts'), `import plugin from './plugin';
export default { collections: { default: { include: ['a.md'], plugins: [plugin] } } };
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

  it('diffs external roots and output ignores when config changes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lume-cms-watch-external-'));
    dirs.push(root);
    const cwd = path.join(root, 'site');
    const sharedA = path.join(root, 'shared-a');
    const sharedB = path.join(root, 'shared-b');
    await mkdir(cwd, { recursive: true });
    await mkdir(sharedA, { recursive: true });
    await mkdir(sharedB, { recursive: true });
    await writeFile(path.join(sharedA, 'page.md'), '---\ntitle: A\n---\nA');
    await writeFile(path.join(sharedB, 'page.md'), '---\ntitle: B\n---\nB');
    await writeFile(path.join(cwd, 'lume.config.ts'), `export default {
  collections: { default: { root: '../shared-a', include: ['**/*.md'] } },
  output: 'old-output.json',
};
`);

    const builds: WatchBuildResult[] = [];
    const watcher = await watchContent({
      cwd,
      debounceMs: 10,
      onBuild: (result) => { builds.push(result); },
    });
    expect(builds.at(-1)?.content.collections.default?.entries[0]?.data.title).toBe('A');

    let previousBuilds = builds.length;
    await writeFile(path.join(cwd, 'lume.config.ts'), `export default {
  collections: { default: { root: '../shared-b', include: ['**/*.md'] } },
  output: 'new-output.json',
};
`);
    await vi.waitFor(() => {
      expect(builds.slice(previousBuilds).some((result) => (
        result.content.collections.default?.entries[0]?.data.title === 'B'
      ))).toBe(true);
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    previousBuilds = builds.length;
    await writeFile(path.join(sharedA, 'page.md'), '---\ntitle: Stale\n---\nStale');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(builds).toHaveLength(previousBuilds);

    await writeFile(path.join(sharedB, 'page.md'), '---\ntitle: Current\n---\nCurrent');
    await vi.waitFor(() => {
      expect(builds.slice(previousBuilds).some((result) => (
        result.content.collections.default?.entries[0]?.data.title === 'Current'
      ))).toBe(true);
    });

    previousBuilds = builds.length;
    await writeFile(path.join(cwd, 'old-output.json'), '{}');
    await vi.waitFor(() => expect(builds.length).toBeGreaterThan(previousBuilds));
    await watcher.close();
  });

  it('preserves child coverage when an overlapping parent root is removed', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lume-cms-watch-overlap-'));
    dirs.push(root);
    const cwd = path.join(root, 'site');
    const shared = path.join(root, 'shared');
    const child = path.join(shared, 'child');
    await mkdir(path.join(cwd, 'content'), { recursive: true });
    await mkdir(child, { recursive: true });
    await writeFile(path.join(shared, 'parent.md'), '---\ntitle: Parent\n---\nParent');
    await writeFile(path.join(child, 'page.md'), '---\ntitle: Child\n---\nChild');
    await writeFile(path.join(cwd, 'content/local.md'), '---\ntitle: Local\n---\nLocal');
    await writeFile(path.join(cwd, 'lume.config.ts'), `export default { collections: {
  parent: { root: '../shared', include: ['parent.md'], baseUrl: '/parent' },
  child: { root: '../shared/child', include: ['*.md'], baseUrl: '/child' },
} };
`);

    const builds: WatchBuildResult[] = [];
    const watcher = await watchContent({
      cwd,
      debounceMs: 10,
      onBuild: (result) => { builds.push(result); },
    });
    expect(builds.at(-1)?.content.collections.child?.entries[0]?.data.title).toBe('Child');

    let previousBuilds = builds.length;
    await writeFile(path.join(cwd, 'lume.config.ts'), `export default { collections: {
  child: { root: '../shared/child', include: ['*.md'], baseUrl: '/child' },
} };
`);
    await vi.waitFor(() => {
      expect(builds.slice(previousBuilds).some((result) => (
        result.content.collections.child?.entries[0]?.data.title === 'Child'
        && result.content.collections.parent === undefined
      ))).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    previousBuilds = builds.length;
    await writeFile(path.join(shared, 'parent.md'), '---\ntitle: Ignored parent\n---\nIgnored parent');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(builds).toHaveLength(previousBuilds);

    await writeFile(path.join(child, 'page.md'), '---\ntitle: Updated child\n---\nUpdated child');
    await vi.waitFor(() => {
      expect(builds.slice(previousBuilds).some((result) => (
        result.content.collections.child?.entries[0]?.data.title === 'Updated child'
      ))).toBe(true);
    });

    previousBuilds = builds.length;
    await writeFile(path.join(cwd, 'lume.config.ts'), `export default { collections: {
  local: { root: 'content', include: ['*.md'], baseUrl: '/local' },
} };
`);
    await vi.waitFor(() => {
      expect(builds.slice(previousBuilds).some((result) => (
        result.content.collections.local?.entries[0]?.data.title === 'Local'
      ))).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    previousBuilds = builds.length;
    await writeFile(path.join(child, 'page.md'), '---\ntitle: Detached child\n---\nDetached child');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(builds).toHaveLength(previousBuilds);

    await writeFile(path.join(cwd, 'lume.config.ts'), `export default { collections: {
  child: { root: '../shared/child', include: ['*.md'], baseUrl: '/child' },
} };
`);
    await vi.waitFor(() => {
      expect(builds.slice(previousBuilds).some((result) => (
        result.content.collections.child?.entries[0]?.data.title === 'Detached child'
      ))).toBe(true);
    });
    previousBuilds = builds.length;
    await writeFile(path.join(child, 'page.md'), '---\ntitle: Reattached child\n---\nReattached child');
    await vi.waitFor(() => {
      expect(builds.slice(previousBuilds).some((result) => (
        result.content.collections.child?.entries[0]?.data.title === 'Reattached child'
      ))).toBe(true);
    });
    await watcher.close();
  });
});
