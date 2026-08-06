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

Run `lume-cms build` before Next.js starts to compile Markdown and MDX into `content.generated.json`.

The docs collection has no time-dependent plugins, so its pages, navigation,
OG images, and Markdown exports use `generateStaticParams()` and remain static.
Blog and cross-collection consumers stay request-time dynamic because they
include the scheduled collection. `getPreviewSource()` is available for a
separate authenticated preview surface; calling `draftMode()` from the public
docs page would opt that route back into dynamic rendering.

## Learn More

To learn more about Next.js and Fumadocs, take a look at the following
resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js
  features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Fumadocs](https://fumadocs.dev) - learn about Fumadocs
