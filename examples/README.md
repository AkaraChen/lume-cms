# app

This is a Next.js application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

Run development server:

```bash
npm run dev
# or
pnpm dev
# or
yarn dev
```

Open http://localhost:3000 with your browser to see the result.

## Explore

In the project, you can see:

- `lib/source.ts`: Code for the `lume-cms` content source adapter.
- `lib/layout.shared.tsx`: Shared options for layouts, optional but preferred to keep.

| Route                     | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `app/(home)`              | The route group for your landing page and other pages. |
| `app/docs`                | The documentation layout and pages.                    |
| `app/api/search/route.ts` | The Route Handler for search.                          |

The `lume-cms/next` plugin compiles Markdown and MDX into
`content.generated.json` before production builds and watches it during development.

The docs detail route checks Next.js `draftMode()` inside each request and uses
the isolated `getPreviewSource()` only when draft mode is enabled. Production
lists, search, RSS, sitemap, OG, and text exports continue to use `getSource()`.

## Content API

`lib/api.ts` mounts the existing `docs` and `blog` factories as one read-only
Hono API. The Next.js catch-all handler lives at
`app/api/content/[[...route]]/route.ts` and stays request-time dynamic. The
TanStack Start route in `tanstack/src/routes/api/content.$.ts` uses the
`createFileRoute(..., { server: { handlers } })` API from the exact locked
`@tanstack/react-start` version.

| API route | Description |
| --- | --- |
| `/api/content/collections` | Collection names, base URLs, and visible page counts |
| `/api/content/collections/:name/pages` | A collection's visible pages |
| `/api/content/collections/:name/pages/*` | One visible page by slug (`_index` for the root page) |
| `/api/content/collections/:name/tree` | Its visibility-safe Fumadocs tree |
| `/api/content/collections/:name/meta` | Meta-file data reachable from that tree |
| `/api/content/pages` | Visible pages across collections |

Page JSON deliberately omits Fumadocs' React `body` component. Full responses
instead contain the original `content`, pure `processedMarkdown`, `toc`, and
`structuredData`. Public responses are cached only until the nearest runtime
visibility deadline (and at most one hour), so scheduled pages become visible
without a new Next.js deployment. Preview responses are always private and
`no-store`.

## Learn More

To learn more about Next.js and Fumadocs, take a look at the following
resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js
  features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Fumadocs](https://fumadocs.dev) - learn about Fumadocs
