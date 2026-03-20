# Release and repository automation

This repository is wired for GitHub-hosted automation across validation, static deployment, dependency maintenance, and package publication.

## Workflows

### `ci.yml`

Runs on pushes to `main` and on pull requests. It installs the pnpm workspace and runs:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

### `pages.yml`

Builds the web app and deploys `apps/web/dist` to GitHub Pages.

Important notes:

- the workflow builds with `GITHUB_PAGES=true`, which makes the Vite config use `/<repo-name>/` as the base path
- if you want the published site to reach a hosted runtime, set the repository variable `VITE_API_BASE_URL`
- if `VITE_API_BASE_URL` is unset, the deployed Pages site will still render but same-origin `/api/*` requests will fail unless you proxy them elsewhere

### `publish-packages.yml`

Publishes the buildable library packages to GitHub Packages when a GitHub Release is published or when the workflow is triggered manually.

The source workspace packages use the `@min-kb-app/*` scope internally. GitHub Packages requires the published npm scope to match the GitHub owner namespace, so the workflow first prepares transformed package copies under:

- `@cmwen/min-kb-app-shared`
- `@cmwen/min-kb-app-min-kb-store`
- `@cmwen/min-kb-app-copilot-runtime`

Those transformed copies are created in `.release/github-packages/` from the built `dist/` outputs and have their internal import specifiers rewritten before publishing.

## Dependabot

Dependabot is configured for:

- the root pnpm workspace
- GitHub Actions workflow updates

## Local preparation

To inspect the transformed GitHub Packages artifacts locally:

```bash
pnpm build:packages
pnpm prepare:github-packages
```

That produces `.release/github-packages/` with publish-ready package folders.

## GitHub repository setup

Recommended repository settings:

1. Enable GitHub Pages with the workflow source.
2. Set the repository variable `VITE_API_BASE_URL` if the static Pages deployment should talk to a hosted runtime.
3. Publish releases from GitHub when you want package versions pushed to GitHub Packages.

## Related files

- `.github/workflows/ci.yml`
- `.github/workflows/pages.yml`
- `.github/workflows/publish-packages.yml`
- `.github/dependabot.yml`
- `apps/web/vite.config.ts`
- `scripts/prepare-github-packages.mjs`
