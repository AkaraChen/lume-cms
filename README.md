# lume-cms

`lume-cms` is a deliberately small content compiler and runtime source for Fumadocs. Authors write Markdown or MDX with frontmatter, the CLI produces deterministic JSON, and one server-only source enforces scheduled visibility for pages, lists, navigation, RSS, sitemap, search, and other consumers.

## Install and configure

```sh
pnpm add lume-cms fumadocs-core valibot
```

Create `lume.config.ts`:

```ts
import * as v from 'valibot';
import { defineConfig } from 'lume-cms/config';
import { schedule } from 'lume-cms/schedule';

export default defineConfig({
  collections: {
    docs: {
      root: 'content/docs',
      include: ['content/docs/**/*.{md,mdx}'],
      schema: v.looseObject({
        title: v.string(),
        description: v.optional(v.string()),
        draft: v.optional(v.boolean(), false),
      }),
    },
    blog: {
      root: 'content/blog',
      include: ['content/blog/**/*.{md,mdx}'],
      schema: v.looseObject({
        title: v.string(),
        description: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
        draft: v.optional(v.boolean(), false),
      }),
    },
  },
  plugins: [schedule()],
  output: 'content.generated.json',
});
```

Each collection owns its root, globs, schema, and optional plugin list. Top-level `plugins` are defaults for collections that omit `plugins`. A source file may belong to only one collection. The old `content` shape remains a one-minor compatibility path, compiles as a collection named `default`, and emits a deprecation warning. Schema-version 2 JSON must be rebuilt; the runtime intentionally does not guess a migration.

The configuration accepts the Standard Schema interface. Valibot 1.x works directly as shown; Zod 4 and other conforming implementations can be used without an adapter. The built-in page schema includes Fumadocs' `title`, `description`, `icon`, and `full` fields. Plugin-owned fields such as `publishDate` stay out of the user schema and compiled page data.

Markdown and MDX use Fumadocs' public YAML frontmatter parser and `mdxPreset()`, matching the official starter baseline: GFM, heading IDs, images, code tabs, npm install blocks, Shiki code highlighting, structured search data, and table-of-contents extraction. `meta.json` is the only JSON content input and is passed to Fumadocs as a native meta file. Its `title`, `description`, `icon`, `root`, `defaultOpen`, `pages`, and `pagesIndex` fields therefore control the page tree with Fumadocs' standard ordering, separators, folder expansion, exclusions, and external-link syntax. The Markdown pipeline is not configurable. The compiler stores a deterministic MDX function body in JSON. Raw HTML in Markdown is deliberately discarded; do not enable `allowDangerousHtml`/`rehype-raw` without adding an explicit sanitization policy. Run `lume-cms build` to generate stable JSON. Entries, meta files, and object keys are sorted, paths are relative, line endings are stable, and no timestamp or machine path is emitted.

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

`collection()` is a type-preserving identity helper: each nested source keeps the page-data fields contributed by its own plugin tuple. The runtime requires the compiled and configured collection names to match in both directions and rejects duplicate `baseUrl` values. `getAllPages()` is the visibility-safe union for sitemap and text exports. The singular `createFumadocsSource()` remains available only when JSON contains exactly one collection.

Plugins run on both sides of the JSON boundary, so each compile collection and runtime source must register the same ordered plugin list. The compiled JSON records plugin ids and the runtime fails immediately if either side is missing, extra, duplicated, or reordered. Fumadocs loader plugins can still be supplied separately through `loaderPlugins`.

Custom plugins can use `definePlugin` from `lume-cms/config`. A plugin frontmatter schema must output only fields owned by that plugin; those validated fields are removed from user page data and passed to its `entry` hook, while unvalidated input is available separately as `rawFrontmatter`. Compile hooks run as `setup` once, `entry` for each file, then `finalize` once; per-entry results are isolated under `entry.ext[plugin.id]`. Runtime hooks can narrow visibility, contribute ordering and page data, and provide the next cache deadline. Registration order is hook order, visibility hooks combine with AND, and duplicate ids fail immediately.

The generated JSON intentionally retains future entries and their bodies. `createFumadocsSource()` applies its only visibility predicate while producing Fumadocs `DynamicSource.files()`. The page tree, search index, navigation and every page lookup derive from those filtered files. Advancing an injected clock across a deadline changes all reads without compiling JSON or rebuilding the app.

The Fumadocs adapter uses its public `DynamicSource` and `dynamicLoader()` APIs. Its cache is deadline-aware:

```text
validUntil = next unpublished publishDate, or Infinity when none remain
```

Each collection caches bounded, immutable loader generations over `[observedAt, validUntil)` intervals. Concurrent reads in one interval coalesce, while an older frozen request keeps its pre-publication generation after a newer request crosses the deadline; evicted generations are safely rebuilt from their frozen time. A docs deadline does not affect blog and vice versa. Pass a request-scoped frozen clock such as React `cache(() => new Date())` at the top level; this keeps navigation, page, metadata, OG, RSS, and search self-consistent when overlapping requests straddle a publication boundary.

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
