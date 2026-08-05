# lume-cms

`lume-cms` is a deliberately small content compiler and runtime source for Fumadocs. Authors write Markdown or MDX with frontmatter, the CLI produces deterministic JSON, and one server-only source enforces scheduled visibility for pages, lists, navigation, RSS, sitemap, search, and other consumers.

## Install and configure

```sh
pnpm add lume-cms fumadocs-core
```

Create `lume.config.ts`:

```ts
import { defineConfig } from 'lume-cms/config';
import { schedule } from 'lume-cms/schedule';

export default defineConfig({
  collections: {
    docs: {
      baseUrl: '/docs',
      root: 'content/docs',
      include: ['content/docs/**/*.{md,mdx}'],
    },
    blog: {
      baseUrl: '/blog',
      root: 'content/blog',
      include: ['content/blog/**/*.{md,mdx}'],
    },
  },
  plugins: [schedule()],
  output: 'content.generated.json',
});
```

Each collection owns its root, globs, schema, public `baseUrl`, and optional plugin list. Top-level `plugins` are defaults for collections that omit `plugins`. A source file may belong to only one collection. The old `content` shape remains a one-minor compatibility path, compiles as a collection named `default`, and emits a deprecation warning. Schema-version 2 JSON must be rebuilt; the runtime intentionally does not guess a migration.

With no schema override, lume-cms imports Fumadocs' locked `pageSchema` and `metaSchema` directly. The configuration accepts the Standard Schema interface, so Valibot 1.x, Zod 4, and other conforming implementations can replace them without an adapter. Plugin-owned fields such as `publishDate` stay out of public page data. Each collection persists its normalized `baseUrl`, so its reference validation and runtime Fumadocs loader cannot drift.

## Schema contract

The default page and meta validators track `fumadocs-core/source/schema` from the installed Fumadocs version. The complete field matrix is:

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

The official Zod objects strip unknown keys. `draft` and `slug` are validated from raw frontmatter and removed before the public page schema runs, so they keep their reserved semantics even when the public schema is replaced. Compilation fails if a schema default or transform tries to emit either reserved key, preventing a second public source of truth. Plugin-owned input such as `publishDate` is also validated from raw frontmatter and removed from public page data.

For the Fumadocs-style `.extend()` workflow, install Zod and extend the exported defaults:

```ts
import { z } from 'zod';
import { defaultMetaSchema, defaultPageSchema, defineConfig } from 'lume-cms/config';

export default defineConfig({
  content: {
    schema: defaultPageSchema.extend({ category: z.enum(['docs', 'blog']) }),
    metaSchema: defaultMetaSchema.extend({ badge: z.string().optional() }),
  },
});
```

Both slots accept any Standard Schema instead, including Valibot 1 and custom implementations. Supplying one is an explicit replacement: include every public field that should survive in compiled data. The private `draft` and `slug` fields remain reserved and cannot be redefined by the public schema.

Schema additions in a future compatible Fumadocs release flow into the defaults because lume-cms imports the official objects rather than copying their shapes. Every Fumadocs upgrade must run the schema conformance tests and review deterministic output changes. Additive official fields remain schema v2; removals or incompatible type changes require a compiled-schema migration. A user-supplied replacement intentionally opts out of automatic additions until that schema is updated.

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
  baseUrl: '/docs',
  i18n,
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
import { i18n } from './lume.config';

export const { getSource } = createFumadocsSource(content, { i18n });
```

The returned official loader supports `getPage(slugs, locale)`, `getPages(locale)`, `getPageTree(locale)`, and `getLanguages()`. With the default `hideLocale: 'never'`, `baseUrl: '/docs'` produces `/en/docs/guide` and `/zh/docs/guide`; Fumadocs' `always` and `default-locale` modes are passed through unchanged. Missing translations inherit `fallbackLanguage` (the default language by default), while `fallbackLanguage: null` disables inheritance. Every locale is built from the same filtered dynamic files: draft content never appears, scheduled translations become visible only at their deadline, and fallback cannot expose a filtered body from another locale.

The runnable `examples/i18n/` fixture shows a two-language dot layout, localized meta files, shared compile/runtime config, and strict reference validation.

Markdown and MDX use Fumadocs' public YAML frontmatter parser and `mdxPreset()`, matching the official starter baseline: GFM, heading IDs, images, code tabs, npm install blocks, Shiki code highlighting, structured search data, and table-of-contents extraction. `meta.json` is the only JSON content input and is passed to Fumadocs as a native meta file. Its `title`, `description`, `icon`, `root`, `defaultOpen`, `collapsible`, `pages`, and `pagesIndex` fields therefore control the page tree with Fumadocs' standard ordering, separators, folder expansion, exclusions, and external-link syntax. The Markdown pipeline is not configurable. The compiler stores a deterministic MDX function body in JSON. Raw HTML in Markdown is deliberately discarded; do not enable `allowDangerousHtml`/`rehype-raw` without adding an explicit sanitization policy. Run `lume-cms build` to generate stable JSON. Entries, meta files, and object keys are sorted, paths are relative, line endings are stable, and no timestamp or machine path is emitted.

### Processed Markdown exports

Every new build stores both text representations in `entry.body`:

| Field | Meaning | Consumer |
| --- | --- | --- |
| `markdown` | original Markdown/MDX body after frontmatter removal | source-aware tooling and backwards-compatible `page.data.content` |
| `processedMarkdown` | pure Markdown after the same remark transforms used for rendering | `llms-full.txt`, per-page Markdown, content negotiation, and EPUB/LLM integrations |

The pure-Markdown degradation is intentionally non-executing and deterministic: ESM imports/exports and JavaScript expressions are removed; MDX/JSX wrapper tags and attributes are removed while their Markdown children are retained. A self-closing component with a literal `title` or `label` becomes plain text, or a Markdown link when it also has a literal `href`; other self-closing components disappear. Standard Markdown and GFM constructs such as headings, links, tables, lists, and fenced code remain. Component-specific rendering is not executed or guessed beyond that portable title/link fallback—authors who need richer text from a visual component should put it in the component's children.

The loader exposes the two values as `page.data.content` (original) and `page.data.processedMarkdown` (export form). Older schema v2 artifacts without the additive field fall back to their original body until rebuilt. The example's shared `getLLMText()` uses `processedMarkdown`, so the full and per-page export routes cannot leak unexpanded JSX or imports.

This intentionally duplicates body text in the JSON artifact. In the three-page example fixture it adds 542 bytes uncompressed and 48 bytes after Brotli (12,639 → 13,181 raw; 2,214 → 2,262 Brotli). Growth is linear and can approach one extra normalized body per page before compression; large-site sharding/lazy-loading thresholds remain KIT-626's benchmark decision rather than being mixed into this compatibility layer.

For local editing, run `lume-cms build --watch`. The first build is clean; later builds reuse an in-memory cache keyed by source path and content plus the resolved content configuration, schema, compiler version, plugin implementation, and plugin `compile.cacheKey`. Add, change, rename, and delete events update the same deterministic output without restarting the process. Configuration and local plugin source changes are reloaded and invalidate affected cache entries. A failed rebuild reports the error, keeps the last successful output, and continues watching so the next edit can recover. Custom plugins whose behavior depends on closed-over options should expose a stable `compile.cacheKey` containing those options.

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
import { cache } from 'react';
import { collection, createFumadocsSources } from 'lume-cms';
import { schedule } from 'lume-cms/schedule';

const requestNow = cache(() => new Date());

export const { sources, getAllSources, getAllPages } = createFumadocsSources(content, {
  now: requestNow,
  collections: {
    docs: collection({ baseUrl: '/docs', plugins: [schedule()] }),
    blog: collection({ baseUrl: '/blog', plugins: [schedule()] }),
  },
});

export const { getSource: getDocsSource } = sources.docs;
export const { getSource: getBlogSource } = sources.blog;
```

`collection()` is a type-preserving identity helper: each nested source keeps the page-data fields contributed by its own plugin tuple. The runtime requires the compiled and configured collection names to match in both directions and rejects duplicate `baseUrl` values. Runtime `baseUrl` values are compatibility confirmations for artifacts created before the field was persisted; conflicting values fail immediately. `getAllPages()` is the visibility-safe union for sitemap and text exports. The singular `createFumadocsSource()` remains available only when JSON contains exactly one collection.

Plugins run on both sides of the JSON boundary, so each compile collection and runtime source must register the same ordered plugin list. The compiled JSON records plugin ids and the runtime fails immediately if either side is missing, extra, duplicated, or reordered. Fumadocs loader plugins can still be supplied separately through `loaderPlugins`.

### Official loader options

Each collection source covers the complete `loader()` option surface from the locked Fumadocs version:

| Official option | lume-cms API | Ownership and behavior |
| --- | --- | --- |
| `baseUrl` | collection compile-time `baseUrl`; optional matching runtime `baseUrl` | persisted collection truth; conflicting runtime duplication fails |
| `i18n` | compile-time `i18n`; optional matching runtime `i18n` | persisted compiler truth; runtime cannot enable or change it |
| `url(slugs, locale)` | runtime `url` | authoritative for page records and page-tree nodes; overrides default `baseUrl` URL generation |
| `slugs(file)` | runtime `slugs` | official callback receives only visible page files; its result replaces compiled fallback slugs in every loader read |
| `pageTree` | runtime `pageTree` | `idPrefix`, `noRef`, `generateFallback`, `transformers`, `context`, and `sort` pass through |
| `icon` | runtime `icon` | resolves page, folder, separator, and external-link icon names |
| `plugins` | runtime `loaderPlugins` | array/nested options and the official `({ typedPlugin }) => [...]` form pass through; renamed to avoid the lume plugin slot |

The official object-form `source` is intentionally unavailable: lume-cms owns each collection's `DynamicSource` so every page enters Fumadocs only after the one draft/deadline visibility filter. `pageTree.url` is also rejected at the type and runtime boundaries; use the top-level `url` callback so page records and navigation cannot acquire different URLs. Page-tree transformers and loader plugins are deliberate low-level escape hatches: they run on the already-filtered virtual storage and must not synthesize unfiltered content or mutate node URLs away from the top-level callback.

For example:

```ts
export const { getSource } = createFumadocsSource(content, {
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
});
```

Runtime `url` and `slugs` functions cannot be serialized into deterministic JSON. The compiler therefore owns file-path/frontmatter slugs and default `baseUrl` reference diagnostics, while these callbacks are the sole public loader override after visibility filtering. Relative source-file links remain statically checkable; custom public URLs cannot be inferred by `--strict`, so links using a custom URL scheme require consumer-level tests. Slug aliases and redirects are intentionally not inferred here and remain KIT-625's scope.

Fumadocs loader plugins are a distinct runtime-only pipeline under `loaderPlugins`.

Custom plugins can use `definePlugin` from `lume-cms/config`. A plugin frontmatter schema must output only fields owned by that plugin; those validated fields are removed from user page data and passed to its `entry` hook, while unvalidated input is available separately as `rawFrontmatter`. Compile hooks run as `setup` once, `entry` for each file, then `finalize` once; per-entry results are isolated under `entry.ext[plugin.id]`. Runtime hooks can narrow visibility, contribute ordering and page data, and provide the next cache deadline. Registration order is hook order, visibility hooks combine with AND, and duplicate ids fail immediately.

The generated JSON intentionally retains future entries and their bodies. `createFumadocsSource()` applies its only visibility predicate while producing Fumadocs `DynamicSource.files()`. The page tree, search index, navigation and every page lookup derive from those filtered files. Advancing an injected clock across a deadline changes all reads without compiling JSON or rebuilding the app.

The Fumadocs adapter uses its public `DynamicSource` and `dynamicLoader()` APIs. Its cache is deadline-aware:

```text
validUntil = next unpublished publishDate, or Infinity when none remain
```

Each collection caches bounded, immutable loader generations over `[observedAt, validUntil)` intervals. Concurrent reads in one interval coalesce, while an older frozen request keeps its pre-publication generation after a newer request crosses the deadline; evicted generations are safely rebuilt from their frozen time. A docs deadline does not affect blog and vice versa. Pass a request-scoped frozen clock such as React `cache(() => new Date())` at the top level; this keeps navigation, page, metadata, OG, RSS, and search self-consistent when overlapping requests straddle a publication boundary.

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
  "UNPUBLISHED_DOCS_TITLE" "UNPUBLISHED_DOCS_BODY" \
  "UNPUBLISHED_BLOG_TITLE" "UNPUBLISHED_BLOG_BODY"
```

The repository-only command fails if the example's `.next/static` contains zero files, preventing a wrong-directory scan from reporting a false success. Consumers should perform an equivalent post-build scan in their own CI. Also derive RSS, sitemap, search, navigation, metadata/OG, text exports, and the content-negotiation proxy path from `getSource()`; these are independent leak paths.

Important: future docs and blog bodies are plaintext in `content.generated.json` and therefore in Git history when that file is committed. A public repository provides no confidentiality even if the website filters entries correctly. Do not commit sensitive future material to a public repository.
