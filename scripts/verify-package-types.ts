import { createFumadocsSource, type CompiledContent } from '../dist/index.mjs';

const nonI18nContent = {
  schemaVersion: 2,
  plugins: [],
  entries: [],
} satisfies CompiledContent;

const i18nContent = {
  schemaVersion: 2,
  plugins: [],
  entries: [],
  i18n: {
    languages: ['en'],
    defaultLanguage: 'en',
    parser: 'dot',
    fallbackLanguage: 'en',
    hideLocale: 'never',
  },
} satisfies CompiledContent;

async function verifyPublishedPageTreeTypes() {
  const nonI18n = await createFumadocsSource(nonI18nContent).getSource();
  nonI18n.pageTree.children;
  // @ts-expect-error A non-i18n page tree is one Root, not a locale record.
  nonI18n.pageTree.en;

  const i18n = await createFumadocsSource(i18nContent).getSource();
  i18n.pageTree.en.children;
}

void verifyPublishedPageTreeTypes;
