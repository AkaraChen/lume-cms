import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { compileContent, serializeCompiledContent } from '../src/compile.js';

const dirs: string[] = [];

async function fixture(files: Record<string, string>) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'lume-cms-'));
  dirs.push(cwd);
  for (const [name, value] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(cwd, name)), { recursive: true });
    await writeFile(path.join(cwd, name), value);
  }
  return cwd;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('compileContent', () => {
  it('compiles frontmatter Markdown and JSON with a Valibot schema', async () => {
    const cwd = await fixture({
      'content/hello.md': '---\ntitle: Hello\npublishDate: 2026-09-01T10:00:00+08:00\n---\n# Heading\nBody',
      'content/data.json': JSON.stringify({ title: 'JSON page', body: '# JSON body' }),
    });
    const result = await compileContent({ cwd, write: false });
    expect(result.entries.map((item) => item.id)).toEqual(['data', 'hello']);
    expect(result.entries[0]?.body.html).toContain('<h1>JSON body</h1>');
    expect(result.entries[1]?.body.toc).toEqual([{ title: 'Heading', url: '#heading', depth: 1 }]);
  });

  it('uses an injected Valibot schema and reports the source path on failure', async () => {
    const cwd = await fixture({ 'content/bad.md': '---\ntitle: Bad\ncategory: nope\n---\nBody' });
    await expect(compileContent({
      cwd,
      write: false,
      config: { content: { schema: v.looseObject({ title: v.string(), category: v.literal('docs') }) } },
    })).rejects.toThrow(/content\/bad\.md: invalid frontmatter/);
  });

  it('rejects invalid or offset-less dates unless defaultTimezone is configured', async () => {
    const cwd = await fixture({ 'content/date.md': '---\ntitle: Date\npublishDate: 2026-09-01\n---\nBody' });
    await expect(compileContent({ cwd, write: false })).rejects.toThrow(/content\/date\.md: invalid publishDate/);
    const result = await compileContent({ cwd, write: false, config: { defaultTimezone: 'Asia/Shanghai' } });
    expect(result.entries[0]?.publishAtMs).toBe(Date.parse('2026-08-31T16:00:00Z'));
  });

  it('normalizes equivalent timezone instants and produces deterministic bytes', async () => {
    const cwd = await fixture({
      'content/a.md': '---\ntitle: A\npublishDate: 2026-09-01T10:00:00+08:00\n---\nA',
      'content/b.md': '---\ntitle: B\npublishDate: 2026-09-01T02:00:00Z\n---\nB',
    });
    const one = await compileContent({ cwd, write: false });
    const two = await compileContent({ cwd, write: false });
    expect(one.entries[0]?.publishAtMs).toBe(one.entries[1]?.publishAtMs);
    expect(serializeCompiledContent(one)).toBe(serializeCompiledContent(two));
    expect(serializeCompiledContent(one)).not.toContain(cwd);
  });

  it('loads lume.config.ts through c12 and writes the configured output', async () => {
    const cwd = await fixture({
      'articles/page.md': '---\ntitle: Page\n---\nBody',
      'lume.config.ts': "export default { content: { root: 'articles', include: ['articles/**/*.md'] }, output: 'out.json' }",
    });
    await compileContent({ cwd });
    const output = JSON.parse(await readFile(path.join(cwd, 'out.json'), 'utf8'));
    expect(output.entries[0].id).toBe('page');
  });
});
