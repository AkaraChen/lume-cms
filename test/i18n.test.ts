import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compileContent, serializeCompiledContent } from '../src/compile.js';
import { defineI18n } from '../src/config.js';
import { createFumadocsSource } from '../src/fumadocs.js';
import { schedule } from '../src/schedule.js';

const dirs: string[] = [];

async function fixture(files: Record<string, string>) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'lume-cms-i18n-'));
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

describe('Fumadocs i18n source contract', () => {
  it('supports dot parsing, fallback page trees, locale URLs, and deadline visibility', async () => {
    const cwd = await fixture({
      'content/meta.json': JSON.stringify({ title: 'English docs', pages: ['index', 'guide', 'only-en', 'shared', 'shared-draft', 'release', 'localized-draft', 'secret', 'draft'] }),
      'content/meta.zh.json': JSON.stringify({ title: '中文文档', pages: ['index', 'guide', 'only-en', 'shared', 'shared-draft', 'release', 'localized-draft', 'secret', 'draft'] }),
      'content/index.mdx': '---\ntitle: Home\n---\n[Setup](./guide/setup.mdx)',
      'content/index.zh.mdx': '---\ntitle: 首页\n---\n[设置](./guide/setup.mdx)\n[Fallback](./only-en.mdx)\n[Absolute fallback](/zh/docs/only-en)',
      'content/guide/meta.json': '{"title":"Guide","pages":["setup"]}',
      'content/guide/meta.zh.json': '{"title":"指南","pages":["setup"]}',
      'content/guide/setup.mdx': '---\ntitle: Setup\n---\nSetup',
      'content/guide/setup.zh.mdx': '---\ntitle: 设置\n---\n设置',
      'content/only-en.mdx': '---\ntitle: English fallback\n---\nFallback',
      'content/shared.$.mdx': '---\ntitle: Shared\n---\nShared',
      'content/shared-draft.$.mdx': '---\ntitle: Shared draft\ndraft: true\n---\nShared draft',
      'content/release.mdx': '---\ntitle: English release\n---\nEnglish',
      'content/release.zh.mdx': '---\ntitle: 中文发布\npublishDate: 1970-01-01T00:00:01Z\n---\nChinese',
      'content/localized-draft.mdx': '---\ntitle: English public\n---\nEnglish',
      'content/localized-draft.zh.mdx': '---\ntitle: 中文草稿\ndraft: true\n---\nChinese draft',
      'content/secret.zh.mdx': '---\ntitle: 定时秘密\npublishDate: 1970-01-01T00:00:01Z\n---\nSecret',
      'content/draft.mdx': '---\ntitle: Draft\ndraft: true\n---\nDraft',
    });
    const i18n = defineI18n({ languages: ['en', 'zh'], defaultLanguage: 'en', parser: 'dot' });
    const content = await compileContent({
      cwd,
      write: false,
      strict: true,
      config: { collections: { default: { baseUrl: '/docs', i18n } }, plugins: [schedule()] },
    });
    const compiled = content.collections.default!;

    expect(compiled.i18n).toEqual({
      languages: ['en', 'zh'],
      defaultLanguage: 'en',
      parser: 'dot',
      fallbackLanguage: 'en',
      hideLocale: 'never',
    });
    expect(compiled.entries.filter((entry) => entry.slug.join('/') === 'guide/setup'))
      .toMatchObject([{ locale: 'en', path: 'guide/setup.mdx' }, { locale: 'zh', path: 'guide/setup.zh.mdx' }]);
    expect(compiled.metas?.map(({ path, locale }) => [path, locale])).toEqual([
      ['guide/meta.json', 'en'],
      ['guide/meta.zh.json', 'zh'],
      ['meta.json', 'en'],
      ['meta.zh.json', 'zh'],
    ]);
    expect(compiled.diagnostics).toEqual([]);
    expect(serializeCompiledContent(content)).toBe(serializeCompiledContent(await compileContent({
      cwd,
      write: false,
      strict: true,
      config: { collections: { default: { baseUrl: '/docs', i18n } }, plugins: [schedule()] },
    })));

    let now = 999;
    const factory = createFumadocsSource(content, {
      i18n,
      now: () => new Date(now),
      plugins: [schedule()],
    });
    const before = await factory.getSource();
    expect(before.getLanguages().map(({ language }) => language)).toEqual(['en', 'zh']);
    expect(before.getPage([], 'en')).toMatchObject({ locale: 'en', url: '/en/docs', data: { title: 'Home' } });
    expect(before.getPage([], 'zh')).toMatchObject({ locale: 'zh', url: '/zh/docs', data: { title: '首页' } });
    expect(before.getPage(['guide', 'setup'], 'zh')).toMatchObject({
      locale: 'zh',
      url: '/zh/docs/guide/setup',
      data: { title: '设置' },
    });
    expect(before.getPage(['only-en'], 'zh')).toMatchObject({
      locale: 'zh',
      url: '/zh/docs/only-en',
      data: { title: 'English fallback' },
    });
    expect(before.getPage(['shared'], 'en')).toMatchObject({ locale: 'en', url: '/en/docs/shared' });
    expect(before.getPage(['shared'], 'zh')).toMatchObject({ locale: 'zh', url: '/zh/docs/shared' });
    expect(before.getPage(['release'], 'zh')?.data.title).toBe('English release');
    expect(before.getPage(['localized-draft'], 'zh')?.data.title).toBe('English public');
    expect(before.getPage(['secret'], 'zh')).toBeUndefined();
    expect(before.getPage(['draft'], 'en')).toBeUndefined();
    expect(before.getPage(['draft'], 'zh')).toBeUndefined();
    expect(before.getPage(['shared-draft'], 'en')).toBeUndefined();
    expect(before.getPage(['shared-draft'], 'zh')).toBeUndefined();
    expect(before.getPageTree('en').name).toBe('English docs');
    expect(before.getPageTree('zh').name).toBe('中文文档');
    expect(JSON.stringify(before.getPageTree('zh'))).not.toContain('/zh/docs/secret');
    expect(JSON.stringify(before.getPageTree('zh'))).not.toContain('/zh/docs/draft');

    const preview = await factory.getPreviewSource({ draft: true, future: true });
    expect(preview.getPage(['release'], 'zh')?.data.title).toBe('中文发布');
    expect(preview.getPage(['shared-draft'], 'en')).toMatchObject({ locale: 'en', data: { title: 'Shared draft' } });
    expect(preview.getPage(['shared-draft'], 'zh')).toMatchObject({ locale: 'zh', data: { title: 'Shared draft' } });
    expect(before.getPage(['release'], 'zh')?.data.title).toBe('English release');

    now = 1_000;
    const after = await factory.getSource();
    expect(after.getPage(['secret'], 'zh')).toMatchObject({ locale: 'zh', data: { title: '定时秘密' } });
    expect(after.getPage(['release'], 'zh')?.data.title).toBe('中文发布');
    expect(after.getPage(['localized-draft'], 'zh')?.data.title).toBe('English public');
    expect(after.getPage(['secret'], 'en')).toBeUndefined();
    expect(JSON.stringify(after.getPageTree('zh'))).toContain('/zh/docs/secret');

    const customized = await createFumadocsSource(content, {
      now: () => new Date(now),
      plugins: [schedule()],
      url: (slugs, locale) => `/${locale}/knowledge/${slugs.join('/')}`,
      slugs: (file) => file.path.startsWith('guide/setup.') ? ['custom-setup'] : undefined,
    }).getSource();
    expect(customized.getPage(['custom-setup'], 'en')?.url).toBe('/en/knowledge/custom-setup');
    expect(customized.getPage(['custom-setup'], 'zh')?.url).toBe('/zh/knowledge/custom-setup');
    expect(customized.getPage(['guide', 'setup'], 'zh')).toBeUndefined();
    expect(JSON.stringify(customized.getPageTree('zh'))).toContain('/zh/knowledge/custom-setup');
  });

  it('supports dir parsing, locale-isolated slugs, no fallback, and hidden default prefixes', async () => {
    const cwd = await fixture({
      'content/en/meta.json': '{"title":"English","pages":["guide"]}',
      'content/fr/meta.json': '{"title":"Français","pages":["guide"]}',
      'content/en/guide/page.mdx': '---\ntitle: Guide\n---\nGuide',
      'content/fr/guide/page.mdx': '---\ntitle: Guide FR\n---\nGuide FR',
      'content/en/only-en.mdx': '---\ntitle: Only English\n---\nOnly English',
    });
    const i18n = defineI18n({
      languages: ['en', 'fr'],
      defaultLanguage: 'en',
      fallbackLanguage: null,
      hideLocale: 'default-locale',
      parser: 'dir',
    });
    const content = await compileContent({ cwd, write: false, config: { collections: { default: { baseUrl: '/docs', i18n } } } });
    const compiled = content.collections.default!;
    const source = await createFumadocsSource(content).getSource();

    expect(compiled.entries.map(({ locale, slug }) => [locale, slug.join('/')])).toEqual([
      ['en', 'guide/page'],
      ['en', 'only-en'],
      ['fr', 'guide/page'],
    ]);
    expect(source.getPage(['guide', 'page'], 'en')?.url).toBe('/docs/guide/page');
    expect(source.getPage(['guide', 'page'], 'fr')?.url).toBe('/fr/docs/guide/page');
    expect(source.getPages('en')).toHaveLength(2);
    expect(source.getPages('fr')).toHaveLength(1);
    expect(source.getPage(['only-en'], 'fr')).toBeUndefined();
    expect(source.getPageTree('en').name).toBe('English');
    expect(source.getPageTree('fr').name).toBe('Français');
  });

  it('still rejects duplicate slugs within one locale', async () => {
    const cwd = await fixture({
      'content/en/a.mdx': '---\ntitle: A\nslug: same\n---\nA',
      'content/en/b.mdx': '---\ntitle: B\nslug: same\n---\nB',
      'content/fr/a.mdx': '---\ntitle: A FR\nslug: same\n---\nA FR',
    });
    const i18n = defineI18n({ languages: ['en', 'fr'], defaultLanguage: 'en', parser: 'dir' });

    await expect(compileContent({ cwd, write: false, config: { collections: { default: { i18n } } } }))
      .rejects.toThrow('Duplicate content slug in locale "en": same');
  });

  it('validates shared-file references in every locale', async () => {
    const cwd = await fixture({
      'content/shared.$.mdx': '---\ntitle: Shared\n---\n[English only](./only-en.mdx)',
      'content/only-en.mdx': '---\ntitle: English only\n---\nEnglish',
    });
    const i18n = defineI18n({
      languages: ['en', 'zh'],
      defaultLanguage: 'en',
      fallbackLanguage: null,
      parser: 'dot',
    });
    const content = await compileContent({ cwd, write: false, config: { collections: { default: { i18n } } } });

    expect(content.collections.default?.diagnostics).toMatchObject([{
      code: 'missing-page',
      sourcePath: 'content/shared.$.mdx',
      target: './only-en.mdx',
    }]);
  });

  it('fails fast when runtime and compiled defineI18n configs drift', async () => {
    const cwd = await fixture({ 'content/page.mdx': '---\ntitle: Page\n---\nPage' });
    const content = await compileContent({
      cwd,
      write: false,
      config: { collections: { default: { i18n: defineI18n({ languages: ['en', 'zh'], defaultLanguage: 'en' }) } } },
    });

    expect(() => createFumadocsSource(content, {
      i18n: defineI18n({ languages: ['en', 'zh'], defaultLanguage: 'zh' }),
    })).toThrow(/Runtime i18n config does not match compiled i18n config/);
  });

  it('rejects runtime i18n when the artifact was compiled without i18n', async () => {
    const cwd = await fixture({
      'content/page.zh.mdx': '---\ntitle: Page\n---\nPage',
    });
    const content = await compileContent({ cwd, write: false });

    expect(content.collections.default?.i18n).toBeUndefined();
    expect(content.collections.default?.entries[0]).toMatchObject({ locale: undefined, slug: ['page.zh'] });
    expect(() => createFumadocsSource(content, {
      i18n: defineI18n({ languages: ['en', 'zh'], defaultLanguage: 'en', parser: 'dot' }),
    })).toThrow(/Runtime i18n requires compiled i18n config/);
  });

  it('resolves explicit cross-language absolute links when locale prefixes are never hidden', async () => {
    const cwd = await fixture({
      'content/index.mdx': '---\ntitle: English\n---\n[French](/fr/docs/guide)',
      'content/index.fr.mdx': '---\ntitle: Français\n---\n[English](/en/docs/guide)',
      'content/guide.mdx': '---\ntitle: Guide\n---\nGuide',
      'content/guide.fr.mdx': '---\ntitle: Guide FR\n---\nGuide FR',
    });
    const i18n = defineI18n({
      languages: ['en', 'fr'],
      defaultLanguage: 'en',
      hideLocale: 'never',
      parser: 'dot',
    });

    const valid = await compileContent({
      cwd, write: false, strict: true, config: { collections: { default: { baseUrl: '/docs', i18n } } },
    });
    expect(valid.collections.default?.diagnostics).toEqual([]);

    await writeFile(path.join(cwd, 'content/index.fr.mdx'), '---\ntitle: Français\n---\n[Missing](/en/docs/missing)');
    const invalid = await compileContent({ cwd, write: false, config: { collections: { default: { baseUrl: '/docs', i18n } } } });
    expect(invalid.collections.default?.diagnostics).toMatchObject([{
      code: 'missing-page',
      sourcePath: 'content/index.fr.mdx',
      target: '/en/docs/missing',
    }]);
  });

  it('resolves cross-language absolute links when only the default locale prefix is hidden', async () => {
    const cwd = await fixture({
      'content/index.mdx': '---\ntitle: English\n---\n[French](/fr/docs/guide)',
      'content/index.fr.mdx': '---\ntitle: Français\n---\n[English](/docs/guide)',
      'content/guide.mdx': '---\ntitle: Guide\n---\nGuide',
      'content/guide.fr.mdx': '---\ntitle: Guide FR\n---\nGuide FR',
    });
    const i18n = defineI18n({
      languages: ['en', 'fr'],
      defaultLanguage: 'en',
      hideLocale: 'default-locale',
      parser: 'dot',
    });

    const content = await compileContent({
      cwd, write: false, strict: true, config: { collections: { default: { baseUrl: '/docs', i18n } } },
    });
    expect(content.collections.default?.diagnostics).toEqual([]);
  });
});
