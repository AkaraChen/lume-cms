import { createFumadocsSource, type CompiledContent } from '../dist/index.mjs';
import type { Root } from 'fumadocs-core/page-tree';

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
  ? true
  : false;
type Expect<Value extends true> = Value;

const nonI18nContent = {
  schemaVersion: 3,
  collections: { default: { baseUrl: '/', plugins: [], entries: [], metas: [] } },
} satisfies CompiledContent;

const i18nContent = {
  schemaVersion: 3,
  collections: { default: {
    baseUrl: '/',
    plugins: [],
    entries: [],
    metas: [],
    i18n: {
      languages: ['en'],
      defaultLanguage: 'en',
      parser: 'dot',
      fallbackLanguage: 'en',
      hideLocale: 'never',
    },
  } },
} satisfies CompiledContent;

async function verifyPublishedPageTreeTypes() {
  const nonI18n = await createFumadocsSource(nonI18nContent).getSource();
  nonI18n.pageTree.children;
  nonI18n.getPages()[0]?.data.content.toUpperCase();
  nonI18n.getPages()[0]?.data.processedMarkdown.toUpperCase();
  const nonI18nPreview = await createFumadocsSource(nonI18nContent).getPreviewSource({
    draft: true,
    future: true,
    reveal: ['expired'],
  });
  nonI18nPreview.getPages()[0]?.data.content.toUpperCase();
  // @ts-expect-error A non-i18n page tree is one Root, not a locale record.
  nonI18n.pageTree.en;

  const i18n = await createFumadocsSource(i18nContent).getSource();
  i18n.pageTree.en.children;

  const wideContent: CompiledContent = i18nContent;
  const wideFactory = createFumadocsSource(wideContent);
  type WidePageTree = Awaited<ReturnType<typeof wideFactory.getSource>>['pageTree'];
  type _WidePageTreeIsHonest = Expect<Equal<WidePageTree, Root | Record<string, Root>>>;
  const wide = await wideFactory.getSource();
  wide.pageTree satisfies Root | Record<string, Root>;

  const narrowed = await createFumadocsSource(wideContent, {
    i18n: { languages: ['en'], defaultLanguage: 'en' },
  }).getSource();
  narrowed.pageTree.en.children;
}

void verifyPublishedPageTreeTypes;
