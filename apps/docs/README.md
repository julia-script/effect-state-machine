# @effect-state-machine/docs

The documentation site for `effect-state-machine`, built with
[Next.js](https://nextjs.org) and [Fumadocs](https://fumadocs.dev), styled with
Tailwind CSS v4.

```sh
pnpm --filter @effect-state-machine/docs dev    # http://localhost:3000
pnpm --filter @effect-state-machine/docs build
```

## Layout

| Path                        | Description                                             |
| --------------------------- | ------------------------------------------------------- |
| `content/docs`              | The MDX pages. Add files here to add documentation.      |
| `src/lib/source.ts`         | Content source adapter — collections and the `loader()`. |
| `src/lib/shared.ts`         | Site name, routes, and GitHub coordinates.               |
| `src/lib/layout.shared.tsx` | Shared layout options (nav, GitHub link).                |
| `src/app/(home)`            | The landing page route group.                            |
| `src/app/docs`              | The documentation layout and pages.                      |
| `src/app/api/search`        | Route handler backing the local search index.            |
| `src/app/llms*`             | `llms.txt` and per-page Markdown for LLM consumers.      |
| `src/app/og`                | Generated Open Graph images.                             |

Collections use the [Macro API](https://fumadocs.dev/docs/mdx/macro), so there
is no `source.config.ts` — everything is declared in `src/lib/source.ts`.
