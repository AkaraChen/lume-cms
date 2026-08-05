# lume-cms

`lume-cms` is a deliberately small content compiler and runtime source for Fumadocs. Authors write Markdown or MDX with frontmatter (or JSON), the CLI produces deterministic JSON, and one server-only source enforces scheduled visibility for pages, lists, navigation, RSS, sitemap, search, and other consumers.

## Install and configure

```sh
pnpm add lume-cms fumadocs-core valibot
```

Create `lume.config.ts`:

```ts
import * as v from 'valibot';
import { defineConfig } from 'lume-cms/config';

export default defineConfig({
  content: {
    root: 'content',
    include: ['content/**/*.{md,mdx,json}'],
    schema: v.looseObject({
      title: v.string(),
      description: v.optional(v.string()),
      publishDate: v.optional(v.string()),
      draft: v.optional(v.boolean(), false),
    }),
  },
  output: 'content.generated.json',
});
```

The configuration accepts the Standard Schema interface. Valibot 1.x works directly as shown; Zod 4 and other conforming implementations can be used without an adapter. The built-in page schema includes Fumadocs' `title`, `description`, `icon`, and `full` fields plus lume's scheduling fields. A `meta.json` file is validated with the matching Fumadocs navigation fields and compiled as a metadata virtual file.

Markdown and MDX use YAML frontmatter. JSON may be one object or an array of objects; its optional `body` field is Markdown. MDX is compiled with the standard `@mdx-js/mdx` compiler to a deterministic function body stored in JSON, while Markdown is compiled to HTML. Raw HTML in Markdown is deliberately discarded; do not enable `allowDangerousHtml`/`rehype-raw` without adding an explicit sanitization policy. Run `lume-cms build` to generate stable JSON. Entries and object keys are sorted, paths are relative, line endings are stable, and no timestamp or machine path is emitted.

The Fumadocs adapter exposes the compiled body as the React component expected by the official starter:

```tsx
const MDX = page.data.body;
return <MDX components={getMDXComponents()} />;
```

Only evaluate JSON produced from trusted repository content. Component evaluation is protected by `server-only`; do not expose compiled MDX code to the client.

`publishDate` accepts ISO 8601 with an explicit offset or `Z`. A plain `YYYY-MM-DD` is rejected unless `defaultTimezone` is configured, in which case it means midnight in that IANA timezone. Invalid values fail compilation with the source path. At runtime an entry is visible exactly when `publishDate <= now`. Missing `publishDate` is immediately visible; `draft: true` is never visible.

## Runtime source

```ts
import content from './content.generated.json';
import { createFumadocsSource } from 'lume-cms/fumadocs';

export const { getSource } = createFumadocsSource(content, {
  baseUrl: '/docs',
});
```

The generated JSON intentionally retains future entries and their bodies. `createContentSource()` applies the only visibility predicate before deriving direct slug lookup, enumeration, navigation, route params, or Fumadocs `DynamicSource.files()`. Advancing an injected clock across a deadline changes all of those reads without compiling JSON or rebuilding the app.

The Fumadocs adapter uses its public `DynamicSource` and `dynamicLoader()` APIs. Its cache is deadline-aware:

```text
validUntil = min(next unpublished publishDate, now + maxStaleMs)
```

It invalidates at that boundary, so a long fallback TTL cannot hold a newly published entry past its deadline.

## Next.js requirements

Version 1 requires request-time rendering with `export const dynamic = 'force-dynamic'` for page details, layouts/navigation, RSS, search, metadata/OG, text exports, and sitemap. Keep `dynamicParams = true`; otherwise a slug absent from build-time params stays unreachable after publication. Every server component and route handler must run `await getSource()` inside the request; never retain an awaited loader instance at module scope. Fumadocs search should receive the factory itself as `createFromSource(getSource)`, so it obtains the current loader instance when indexing.

Sitemaps are metadata routes and static by default, so `app/sitemap.ts` must also export `dynamic = 'force-dynamic'`. All consumers use request-time visibility; do not add a static route or an additional cache around the source. The `examples/` directory is the official Create Fumadocs starter with only the source wiring changed, plus the minimal RSS and sitemap routes required by this package's acceptance criteria.

## Preventing leaks

The runtime entry points import `server-only`. Keep the JSON and any module that imports it behind the server boundary. After building an example Next.js app, scan client assets using distinctive unpublished title/body markers:

```sh
lume-cms scan-client ./path/to/next-app "UNPUBLISHED_TITLE" "UNPUBLISHED_BODY_SENTINEL"
```

The command is shipped in the package and fails if the app's `.next/static` contains zero files, preventing a wrong-directory scan from reporting a false success. Run it after `next build` in the consuming app's CI. Also derive RSS, sitemap, search, navigation, metadata/OG, text exports, and the content-negotiation proxy path from `getSource()`; these are independent leak paths.

The `/unsafe` export contains `unsafe_getAllEntriesIncludingUnpublished()` only for authenticated server-side previews. It returns a detached, deeply frozen snapshot so preview code cannot mutate the live source. The main entry does not re-export it.

Important: future bodies are plaintext in `content.generated.json` and therefore in Git history when that file is committed. This is accepted for the private v1 repository, but a public repository provides no confidentiality even if the website filters entries correctly. Do not commit sensitive future material to a public repository.
