# lume-cms

`lume-cms` is a deliberately small content compiler and runtime source for Fumadocs. Authors write Markdown or MDX with frontmatter, the CLI produces deterministic JSON, and one server-only source enforces scheduled visibility for pages, lists, navigation, RSS, sitemap, search, and other consumers.

## Install and configure

```sh
pnpm add lume-cms fumadocs-core
```

Create `lume.config.ts`:

```ts
import { collection, defineConfig } from 'lume-cms/config';
import { schedule } from 'lume-cms/schedule';

export default defineConfig({
  collections: {
    docs: collection({
      baseUrl: '/docs',
      root: 'content/docs',
      include: ['**/*.{md,mdx}'],
    }),
    blog: collection({
      baseUrl: '/blog',
      root: 'content/blog',
      include: ['**/*.{md,mdx}'],
      plugins: [schedule({ sort: 'date-desc' })],
    }),
  },
  output: 'content.generated.json',
});
```

Each collection owns its root, root-relative globs, schema, public `baseUrl`, runtime loader options, and plugin list. Plugins never apply globally: here `schedule()` extends and filters `blog`, while `docs` has no scheduling field or behavior. `collection()` preserves that plugin tuple for runtime page-data inference. A source file may belong to only one collection. Omitting `collections` creates one collection named `default`. Schema-version 2 JSON must be rebuilt; the runtime intentionally does not guess a migration.

The package boundaries keep the core slim without adding API-only splits: `lume-cms/config` owns config, plugin identities, and the Valibot default schemas. Package dependencies are kept external, including Valibot and the CLI's c12 dependency, so size limits measure lume-cms source rather than third-party code. `lume-cms/schedule` owns scheduling, and the root `lume-cms` entry owns the server runtime. Importing `lume.config.ts` from a server module does not pull the c12 config loader into the application path.

With no schema override, lume-cms uses Valibot schemas matching Fumadocs' public page and meta fields. The configuration accepts the Standard Schema interface, so other conforming implementations can replace them without an adapter. Plugin-owned fields such as `publishDate` stay out of public page data. Each collection persists its normalized `baseUrl`, so its reference validation and runtime Fumadocs loader cannot drift.

## Schema contract

The default page and meta validators are implemented with Valibot and match the Fumadocs public data contract. The complete field matrix is:

| File | Field | Fumadocs | lume-cms default | Boundary |
| --- | --- | --- | --- | --- |
| page | `title` | required string | same | public page data |
| page | `description` | optional string | same | public page data |
| page | `icon` | optional string | same | public page data |
| page | `full` | optional boolean | same | public page data |
| page | `_openapi` | optional JSON record | same | public page data |
| page | `tags` | absent | optional string array | public extension retained for search/tag integrations |
| page | `draft` | absent | optional boolean | private compiler control; stored as `entry.draft`, never page data |
| page | `slug` | absent | optional string | private compiler control; stored as `entry.slug`, never page data |
| meta | `title` | optional string | same | public meta data |
| meta | `pages` | optional string array | same | public meta data |
| meta | `pagesIndex` | optional string | same | public meta data |
| meta | `description` | optional string | same | public meta data |
| meta | `root` | optional boolean | same | public meta data |
| meta | `defaultOpen` | optional boolean | same | public meta data |
| meta | `collapsible` | optional boolean | same | public meta data |
| meta | `icon` | optional string | same | public meta data |

The Valibot defaults strip unknown keys. `draft` and `slug` are validated from raw frontmatter and removed before the public page schema runs, so they keep their reserved semantics even when the public schema is replaced. Compilation fails if a schema default or transform tries to emit either reserved key, preventing a second public source of truth. Plugin-owned input such as `publishDate` is also validated from raw frontmatter and removed from public page data.

Extend the exported Valibot defaults by composing their entries:

```ts
import * as v from 'valibot';
import { defaultMetaSchema, defaultPageSchema, defineConfig } from 'lume-cms/config';

export default defineConfig({
  collections: {
    default: {
      schema: v.object({ ...defaultPageSchema.entries, category: v.picklist(['docs', 'blog']) }),
      metaSchema: v.object({ ...defaultMetaSchema.entries, badge: v.optional(v.string()) }),
    },
  },
});
```

Both slots accept any Standard Schema instead. Supplying one is an explicit replacement: include every public field that should survive in compiled data. The private `draft` and `slug` fields remain reserved and cannot be redefined by the public schema.

Every Fumadocs upgrade must review the field matrix and run the schema contract tests. Changes that make existing compiled artifacts invalid require a compiled-schema migration. A user-supplied replacement intentionally opts out of default additions until that schema is updated.

## Internationalization

Use the official `defineI18n()` contract from `lume-cms/config` (a direct Fumadocs re-export) as the single compile/runtime configuration:

```ts
import { defineConfig, defineI18n } from 'lume-cms/config';

export const i18n = defineI18n({
  languages: ['en', 'zh'],
  defaultLanguage: 'en',
  fallbackLanguage: 'en', // use null to disable missing-translation fallback
  parser: 'dot',
});

export default defineConfig({
  collections: {
    default: { baseUrl: '/docs', i18n },
  },
});
```

The two official file layouts are supported for pages and `meta.json`:

| Parser | Default language | Chinese translation |
| --- | --- | --- |
| `dot` | `guide/page.mdx`, `guide/meta.json` | `guide/page.zh.mdx`, `guide/meta.zh.json` |
| `dir` | `en/guide/page.mdx`, `en/guide/meta.json` | `zh/guide/page.mdx`, `zh/guide/meta.json` |

Unmarked dot files belong to `defaultLanguage`; `$` in the locale position shares a file across all languages, matching Fumadocs storage semantics. Compilation persists the normalized i18n config and each file's locale, derives slugs after removing the locale marker, and checks duplicate slugs per locale. Thus the same slug can exist in English and Chinese but still fails when duplicated within one language.

Pass the same object at runtime to detect configuration drift (new artifacts can also use the persisted config without repeating it). Runtime configuration only confirms persisted i18n; it cannot enable i18n for an artifact compiled without it, because locale parsing and slugs are fixed during compilation:

```ts
import content from './content.generated.json';
import { createFumadocsSource } from 'lume-cms';
import config from './lume.config';

export const { getSource } = createFumadocsSource(content, config);
```

The returned official loader supports `getPage(slugs, locale)`, `getPages(locale)`, `getPageTree(locale)`, and `getLanguages()`. With the default `hideLocale: 'never'`, `baseUrl: '/docs'` produces `/en/docs/guide` and `/zh/docs/guide`; Fumadocs' `always` and `default-locale` modes are passed through unchanged. Missing translations inherit `fallbackLanguage` (the default language by default), while `fallbackLanguage: null` disables inheritance. Every locale is built from the same filtered dynamic files: draft content never appears, scheduled translations become visible only at their deadline, and fallback cannot expose a filtered body from another locale.

The runnable `examples/i18n/` fixture shows a two-language dot layout, localized meta files, shared compile/runtime config, and strict reference validation.

Markdown and MDX use Fumadocs' public YAML frontmatter parser and `mdxPreset()`, matching the official starter baseline: GFM, heading IDs, images, code tabs, npm install blocks, Shiki code highlighting, structured search data, and table-of-contents extraction. `meta.json` is the only JSON content input and is passed to Fumadocs as a native meta file. Its `title`, `description`, `icon`, `root`, `defaultOpen`, `collapsible`, `pages`, and `pagesIndex` fields therefore control the page tree with Fumadocs' standard ordering, separators, folder expansion, exclusions, and external-link syntax. The Markdown pipeline is not configurable. The compiler stores a deterministic MDX function body in JSON. Raw HTML in Markdown is deliberately discarded; do not enable `allowDangerousHtml`/`rehype-raw` without adding an explicit sanitization policy. Run `lume-cms build` to generate stable JSON. Entries, meta files, and object keys are sorted, paths are relative, line endings are stable, and no timestamp or machine path is emitted.

### Processed Markdown exports

Every new build stores both text representations in `entry.body`:

| Field | Meaning | Consumer |
| --- | --- | --- |
| `markdown` | original Markdown/MDX body after frontmatter removal | source-aware tooling and `page.data.content` |
| `processedMarkdown` | pure Markdown after the same remark transforms used for rendering | `llms-full.txt`, per-page Markdown, content negotiation, and EPUB/LLM integrations |

The pure-Markdown degradation is intentionally non-executing and deterministic: ESM imports/exports and JavaScript expressions are removed; MDX/JSX wrapper tags and attributes are removed while their Markdown children are retained. A self-closing component with a literal `title` or `label` becomes plain text, or a Markdown link when it also has a literal `href`; other self-closing components disappear. Standard Markdown and GFM constructs such as headings, links, tables, lists, and fenced code remain. Component-specific rendering is not executed or guessed beyond that portable title/link fallback—authors who need richer text from a visual component should put it in the component's children.

The loader exposes the two values as `page.data.content` (original) and `page.data.processedMarkdown` (export form). The example's shared `getLLMText()` uses `processedMarkdown`, so the full and per-page export routes cannot leak unexpanded JSX or imports.

This intentionally duplicates body text in the JSON artifact. In the three-page example fixture it adds 542 bytes uncompressed and 48 bytes after Brotli (12,639 → 13,181 raw; 2,214 → 2,262 Brotli). Growth is linear and can approach one extra normalized body per page before compression; large-site sharding/lazy-loading thresholds remain KIT-626's benchmark decision rather than being mixed into the export contract.

For local editing, run `lume-cms build --watch`. The first build is clean; later builds reuse an in-memory cache keyed by source path and content plus the resolved content configuration, schema, compiler version, plugin implementation, and plugin `build.cacheKey`. Add, change, rename, and delete events update the same deterministic output without restarting the process. Configuration and local plugin source changes are reloaded and invalidate affected cache entries. A failed rebuild reports the error, keeps the last successful output, and continues watching so the next edit can recover. Custom plugins whose behavior depends on closed-over options should expose a stable `build.cacheKey` containing those options.

Keep process orchestration in the consuming app. For example, install `concurrently` as that app's dev dependency and give content compilation and Next.js separate scripts:

```json
{
  "scripts": {
    "dev:content": "lume-cms build --watch",
    "dev:web": "next dev",
    "dev": "concurrently --kill-others --success first --names content,web \"pnpm dev:content\" \"pnpm dev:web\""
  },
  "devDependencies": {
    "concurrently": "^9.2.4"
  }
}
```

`pnpm dev` then starts both processes and forwards Ctrl-C so both the content watcher and Next.js shut down together. `concurrently` belongs to the consuming app only; it is not a `lume-cms` runtime dependency.

Every build also validates static content references and emits deterministic JSON diagnostics with a source path, line, column, target, and code. Missing content pages, heading anchors, Markdown images, literal MDX `<img src>` values, and linked local assets are warnings by default, so the output is still written; use `lume-cms build --strict` (with or without `--watch`) to fail the build and preserve the last successful output. Relative page and asset paths resolve from the authoring file; clean URLs with a trailing slash resolve either a direct page or a directory `index` page. Existing extensionless files such as `LICENSE` and `CNAME` are accepted as local resources after page resolution. Absolute page links strip the configured `baseUrl`, while absolute asset paths resolve from `public/`, matching Fumadocs `remarkImage({ useImport: false })` URL semantics. HTTP(S), protocol, code-block, and dynamic JSX-expression targets are not fetched or guessed; literal Markdown reference links and literal `<a href>` values are checked.

Reference validation uses the complete compiled graph, including draft and scheduled entries. A visible page may therefore link to a real hidden entry without producing a false “missing page” diagnostic, while broken links originating inside draft or future content are still reported. This static graph does not expose hidden entries: all runtime consumers continue to use the single deadline-aware visibility predicate.

The Fumadocs adapter exposes the compiled body as the React component expected by the official starter:

```tsx
const MDX = page.data.body;
return <MDX components={getMDXComponents()} />;
```

Only evaluate JSON produced from trusted repository content. Component evaluation is protected by `server-only`; do not expose compiled MDX code to the client.

The independently importable `schedule()` plugin owns `publishDate`. It accepts ISO 8601 with an explicit offset or `Z`; plain dates and invalid values fail compilation with the source path. At runtime an entry is visible exactly when `publishDate <= now`. Missing `publishDate` is immediately visible; `draft: true` is never visible. Scheduling does not change source order by default, so docs continue to follow `meta.json`. A blog that wants newest-first enumeration can opt in with `schedule({ sort: 'date-desc' })`. Without `schedule()`, lume-cms performs no time filtering and exposes no `publishDate` page field.

## Runtime source

```ts
import content from './content.generated.json';
import { createFumadocsSources } from 'lume-cms';
import config from './lume.config';

export const { sources, getAllSources, getAllPages } = createFumadocsSources(content, config);

export const { getSource: getDocsSource } = sources.docs;
export const { getSource: getBlogSource } = sources.blog;
```

The same config object drives compilation and runtime construction. Node-only build fields (`root`, globs, schemas) are ignored by the runtime; runtime-only loader callbacks are ignored by the compiler. The JSON import remains explicit so Next.js can statically trace the generated artifact. The runtime requires compiled and configured collection names to match in both directions and rejects duplicate compiled `baseUrl` values. `getAllPages()` is the visibility-safe union for sitemap and text exports. The singular `createFumadocsSource()` is the first-class entry point when JSON contains exactly one collection.

Plugins expose explicit build and runtime capabilities. `LumeBuildPlugin` and `LumeRuntimePlugin` are nominally incompatible, while `definePlugin()` can return one object implementing both; `schedule()` does exactly that. Its build half extends frontmatter and compiles publication metadata, and its runtime half filters, decorates, sorts, and calculates the next deadline. `defineBuildPlugin()` and `defineRuntimePlugin()` are available for one-sided plugins. Compiled JSON records build-plugin ids and startup validates each collection's ordered build-plugin list. Fumadocs loader plugins remain a distinct runtime-only pipeline under `loaderPlugins`.

### Per-request preview

Each collection factory also returns `getPreviewSource(options)`. Its sparse options enable
only the requested built-in visibility dimensions: `draft` and `future`.
Custom hide reasons can be revealed with `reveal: ['reason']`;
an entry carrying multiple reasons remains hidden until every reason is revealed.
Options are normalized before runtime plugins run.
The built-in `schedule()` plugin relaxes its date check only for
`future: true`; plugins that ignore `context.preview` retain their normal,
restrictive visibility behavior.

Guard preview reads with Next.js draft mode in the same request that renders the
page. Authentication and authorization of the route that enables draft mode are
the application's responsibility; lume-cms does not validate preview tokens:

```tsx
import { draftMode } from 'next/headers';
import { notFound } from 'next/navigation';
import { getDocsPreviewSource, getDocsSource } from '@/lib/source';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: PageProps<'/docs/[[...slug]]'>) {
  const { slug } = await params;
  const preview = (await draftMode()).isEnabled;
  const source = preview
    ? await getDocsPreviewSource({ draft: true, future: true })
    : await getDocsSource();
  const page = source.getPage(slug);
  if (!page) notFound();

  const MDX = page.data.body;
  return <MDX />;
}
```

Each preview call creates a fresh, uncached loader. It does not participate in
the public loader's publication deadline, refresh coalescing, or `invalidate()`
state. Never put a preview response in shared CDN or ISR cache. Preview still
executes compiled MDX, so only use artifacts built from trusted repository
content. Search, RSS, sitemap, OG, `llms`/Markdown exports, and every other
public consumer must remain fixed to `getSource()`.

The preview API remains covered by the repository's Brotli size budgets.

### Official loader options

Each collection source covers the complete `loader()` option surface from the locked Fumadocs version:

| Official option | lume-cms API | Ownership and behavior |
| --- | --- | --- |
| `baseUrl` | collection `baseUrl` | persisted collection truth shared by reference validation and runtime URLs |
| `i18n` | collection `i18n` | persisted compiler truth; runtime cannot enable or change it |
| `url(slugs, locale)` | collection `url` | runtime callback authoritative for page records and page-tree nodes |
| `slugs(file)` | collection `slugs` | runtime callback receives only visible page files |
| `pageTree` | collection `pageTree` | runtime `idPrefix`, `noRef`, `generateFallback`, transformers, context, and sort |
| `icon` | collection `icon` | runtime resolver for page, folder, separator, and external-link icon names |
| `plugins` | collection `loaderPlugins` | Fumadocs runtime plugins, renamed to distinguish them from lume plugins |

The official object-form `source` is intentionally unavailable: lume-cms owns each collection's `DynamicSource` so every page enters Fumadocs only after the one draft/deadline visibility filter. `pageTree.url` is also rejected at the type and runtime boundaries; use the collection's `url` callback so page records and navigation cannot acquire different URLs. Page-tree transformers and loader plugins are deliberate low-level escape hatches: they run on the already-filtered virtual storage and must not synthesize unfiltered content or mutate node URLs away from the collection callback.

For example:

```ts
export const { getSource } = createFumadocsSource(content, {
  collections: {
    default: {
      url: (slugs, locale) => `/${[locale, 'knowledge', ...slugs].filter(Boolean).join('/')}`,
      slugs: (file) => typeof file.data.route === 'string'
        ? file.data.route.split('/').filter(Boolean)
        : undefined,
      icon: (name) => name ? icons[name] : undefined,
      pageTree: {
        sort: { by: 'name', locales: ['en', 'zh'] },
        transformers: [myTreeTransformer],
      },
      loaderPlugins: ({ typedPlugin }) => [typedPlugin(myLoaderPlugin)],
    },
  },
});
```

Runtime `url` and `slugs` functions cannot be serialized into deterministic JSON. The compiler therefore owns file-path/frontmatter slugs and default `baseUrl` reference diagnostics, while these callbacks are the sole public loader override after visibility filtering. Relative source-file links remain statically checkable; custom public URLs cannot be inferred by `--strict`, so links using a custom URL scheme require consumer-level tests. Slug aliases and redirects are intentionally not inferred here and remain KIT-625's scope.

Fumadocs loader plugins are a distinct runtime-only pipeline under `loaderPlugins`.

Custom plugins use `defineBuildPlugin()`, `defineRuntimePlugin()`, or `definePlugin()` from `lume-cms/config`. Build and runtime plugin types carry different private brands, so accidentally passing a one-sided plugin to the wrong pipeline is a type error. A dual plugin is their intersection and remains one ordinary object in user config. A build plugin's frontmatter schema must output only fields it owns; those validated fields are removed from user page data and passed to its `build.entry` hook, while unvalidated input is available separately as `rawFrontmatter`. Build stages are `setup`, isolated per-file `entry`, then `collection`. `setup` and `collection` are middleware; `entry` is stored under `entry.ext[plugin.id]`, preserving plugin isolation and `build.cacheKey` semantics.

Runtime stages are `resolve`, `list`, then `deadline`. Middleware receives `next` last: registration order is outside-in before `next()` and inside-out afterward, and calling `next()` twice throws. `resolve` marks a generation-scoped `ResolvedEntry` with `hide(reason)`, private state, or page-data patches. The core `list` stage applies every hide reason and default ordering once, so detail pages, lists, RSS, sitemap, navigation, and search cannot drift. Time-dependent plugins must supply `deadline`; `defineTimeGate()` derives both the hide mark and invalidation boundary from one declaration. Compiled schema v3 and the `ext` layout are unchanged.

The generated JSON intentionally retains future entries and their bodies. `createFumadocsSource()` applies its only visibility predicate while producing Fumadocs `DynamicSource.files()`. The page tree, search index, navigation and every page lookup derive from those filtered files. The runtime reads its internal system clock on every `getSource()` call; there is no public clock option to configure. Crossing a deadline changes all reads without compiling JSON or rebuilding the app.

The Fumadocs adapter uses its public `DynamicSource` and `dynamicLoader()` APIs. Its cache is deadline-aware:

```text
validUntil = next unpublished publishDate, or Infinity when none remain
```

Each collection caches bounded, immutable loader generations over `[observedAt, validUntil)` intervals. Concurrent reads in one interval coalesce; after the system clock crosses a deadline, the next call selects or creates the matching generation. A docs deadline does not affect blog and vice versa. A returned loader is immutable, so all reads from that loader—navigation, page, metadata, OG, RSS, and search—share one visibility snapshot.

## Dynamic search

For one collection, pass the `getSource` function itself to Fumadocs search. `createFromSource()` keys its index by the returned loader instance, so when lume-cms invalidates that instance at the next visibility deadline, the following search request rebuilds from the new filtered page set without recompiling content or redeploying Next.js. `localeMap` remains supported on this path for an explicit tokenizer per locale, but Fumadocs 16 marks it deprecated because the default `multilingual` tokenizer needs no mapping; omit it unless a language-specific tokenizer is intentional.

For multiple collections, obtain `getAllSources()` inside every request and pass their currently visible pages to `createSearchAPI('advanced')`. The runnable route in `examples/app/api/search/route.ts` carries both collection names and the default schema's `tags` extension into the official advanced index:

```ts
import { getAllSources } from '@/lib/source';
import { createSearchAPI } from 'fumadocs-core/search/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const loaded = await getAllSources();
  const api = createSearchAPI('advanced', {
    indexes: Object.entries(loaded).flatMap(([tag, source]) =>
      source.getPages().map((page) => ({
      id: `${tag}:${page.url}`,
      title: page.data.title,
      description: page.data.description,
      url: page.url,
      locale: page.locale,
      structuredData: page.data.structuredData,
      tag: [tag, ...(page.data.tags ?? [])],
    }))),
  });
  return api.GET(request);
}
```

`/api/search?query=component&tag=docs,guide` then exercises Fumadocs' end-to-end tag filter; comma-separated tags require every named tag. The `locale` query parameter selects the isolated locale index for i18n sources. Do not await a loader at module scope or add an independent cache around either search route.

The search source contains only pages already admitted by the shared visibility predicate. Draft pages and entries hidden by any runtime plugin are never indexed. A scheduled page enters the next request's index exactly at its deadline. This contract is for the dynamic server route; static index export remains outside this mode because it cannot refresh at a future deadline by itself.

## Next.js requirements

Request-time publishing requires `export const dynamic = 'force-dynamic'` for every collection's page details, layouts/navigation, lists, RSS, search, metadata/OG, text exports, and sitemap. Every server component and route handler must load its source inside the request; never retain an awaited loader instance at module scope. Single-source search can use `createFromSource(getSource)`. Multi-source search should use `createSearchAPI('advanced', { indexes })`, tag every collection's pages, and create the search API inside the request so a future post appears without a redeploy.

Sitemaps are metadata routes and static by default, so `app/sitemap.ts` must also export `dynamic = 'force-dynamic'`. All consumers use request-time visibility; do not add a static route or an additional cache around the source. The `examples/` directory is the official Create Fumadocs starter with only the source wiring changed, plus the minimal RSS and sitemap routes required by this package's acceptance criteria.

## Preventing leaks

The runtime entry points import `server-only`. Keep the JSON and any module that imports it behind the server boundary. After building an example Next.js app, scan client assets using distinctive unpublished title/body markers:

```sh
node scripts/scan-client.mjs examples \
  "UNPUBLISHED_BLOG_TITLE" "UNPUBLISHED_BLOG_BODY"
```

The repository-only command fails if the example's `.next/static` contains zero files, preventing a wrong-directory scan from reporting a false success. Consumers should perform an equivalent post-build scan in their own CI. Also derive RSS, sitemap, search, navigation, metadata/OG, text exports, and the content-negotiation proxy path from `getSource()`; these are independent leak paths.

Important: future docs and blog bodies are plaintext in `content.generated.json` and therefore in Git history when that file is committed. A public repository provides no confidentiality even if the website filters entries correctly. Do not commit sensitive future material to a public repository.
