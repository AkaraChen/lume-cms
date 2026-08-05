import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CompileCache, compileContent, serializeCompiledContent } from '../src/compile.js';
import { createFumadocsSource } from '../src/index.js';
import { schedule } from '../src/schedule.js';

const dirs: string[] = [];

async function fixture(files: Record<string, string>) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'lume-cms-diagnostics-'));
  dirs.push(cwd);
  for (const [name, value] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(cwd, name)), { recursive: true });
    await writeFile(path.join(cwd, name), value);
  }
  return cwd;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('content reference diagnostics', () => {
  it('finds missing pages, headings, and resources without flagging common legal MDX', async () => {
    const cwd = await fixture({
      'content/index.mdx': `---
title: Home
---
# Home

[Guide](./guide.mdx#setup)
[Guide clean URL](./guide#setup)
[Guide absolute](/guide#setup)
[Guide reference][guide]
[Root](/)
[External](https://example.com/docs)
[Email](mailto:docs@example.com)

![Logo](./assets/logo.png)
![Public logo](/root.svg)
<img src={dynamicImage} />
<a href={dynamicHref}>Dynamic</a>
<div id="custom-anchor" />
[Custom anchor](#custom-anchor)

~~~md
[Code fence](./not-a-page)
~~~

[Missing page](./missing)
[Missing heading](./guide#missing-heading)
![Missing image](./assets/missing.png)
[Missing PDF](./assets/missing.pdf)

[guide]: ./guide.mdx#setup
`,
      'content/guide.mdx': '---\ntitle: Guide\n---\n# Setup\n\nGuide',
      'content/assets/logo.png': 'not decoded during reference validation',
      'public/root.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    });
    const cache = new CompileCache();
    const result = await compileContent({ cwd, write: false, cache });

    expect(result.collections.default?.diagnostics?.map(({ code, target }) => [code, target])).toEqual([
      ['missing-page', './missing'],
      ['missing-anchor', './guide#missing-heading'],
      ['missing-resource', './assets/missing.png'],
      ['missing-resource', './assets/missing.pdf'],
    ]);
    for (const item of result.collections.default?.diagnostics ?? []) {
      expect(item).toMatchObject({ severity: 'warning', sourcePath: 'content/index.mdx' });
      expect(item.line).toBeGreaterThan(1);
      expect(item.column).toBeGreaterThan(0);
    }

    const cached = await compileContent({ cwd, write: false, cache });
    const clean = await compileContent({ cwd, write: false, cache: new CompileCache() });
    expect(serializeCompiledContent(cached)).toBe(serializeCompiledContent(clean));
  });

  it('makes the same diagnostics fatal only in strict mode', async () => {
    const cwd = await fixture({
      'content/page.md': '---\ntitle: Page\n---\n[Missing](./missing)',
    });
    const nonStrict = await compileContent({ cwd, write: false });
    expect(nonStrict.collections.default?.diagnostics).toHaveLength(1);

    await expect(compileContent({ cwd, write: false, strict: true })).rejects.toMatchObject({
      name: 'CompileDiagnosticsError',
      diagnostics: [{ code: 'missing-page', target: './missing' }],
    });
  });

  it('accepts trailing-slash pages, extensionless resources, and configured base URLs in strict mode', async () => {
    const cwd = await fixture({
      'content/index.md': `---
title: Home
---
[Direct page](./guide/)
[Directory index](./manual/)
[Base direct](/docs/guide/)
[Base index](/docs/manual/)
[License](./LICENSE)
[CNAME](/CNAME)
`,
      'content/guide.mdx': '---\ntitle: Guide\n---\nGuide',
      'content/manual/index.mdx': '---\ntitle: Manual\n---\nManual',
      'content/LICENSE': 'example license',
      'public/CNAME': 'docs.example.com',
    });
    const result = await compileContent({
      cwd,
      write: false,
      strict: true,
      config: { collections: { default: { baseUrl: '/docs/' } } },
    });

    expect(result.collections.default?.baseUrl).toBe('/docs');
    expect(result.collections.default?.diagnostics).toEqual([]);
    const source = await createFumadocsSource(result).getSource();
    expect(source.getPage(['guide'])?.url).toBe('/docs/guide');
    expect(source.getPage(['manual'])?.url).toBe('/docs/manual');
  });

  it('validates every source entry without treating draft or scheduled targets as missing', async () => {
    const cwd = await fixture({
      'content/index.md': `---
title: Home
---
[Draft](./draft.md#draft-heading)
[Scheduled](./scheduled.md#scheduled-heading)
`,
      'content/draft.md': `---
title: Draft
draft: true
---
# Draft heading
[Broken from draft](./missing-from-draft)
`,
      'content/scheduled.md': `---
title: Scheduled
publishDate: 2099-01-01T00:00:00Z
---
# Scheduled heading
[Broken from scheduled](./missing-from-scheduled)
`,
    });
    const result = await compileContent({ cwd, write: false, config: { plugins: [schedule()] } });

    expect(result.collections.default?.diagnostics?.map(({ sourcePath, target }) => [sourcePath, target])).toEqual([
      ['content/draft.md', './missing-from-draft'],
      ['content/scheduled.md', './missing-from-scheduled'],
    ]);
  });
});
