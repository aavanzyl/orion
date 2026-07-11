# Contributing to Orion

Thanks for your interest in contributing! This guide covers how to get set up,
the conventions we follow, and how to submit changes.

## Getting started

Orion is an [Nx](https://nx.dev) monorepo. You'll need **Node.js 20+** and npm.

```bash
git clone https://github.com/aavanzyl/orion.git
cd orion
npm install
cp .env.example .env   # fill in values as needed
```

## Development workflow

1. Fork the repo and create a branch off `main`.
2. Make your change, keeping commits focused and descriptive.
3. Add or update tests. All tests are **network-free and deterministic**.
4. Run the checks below before opening a pull request.
5. Open a PR using the template and link any related issues.

## Testing and checks

Run these with Nx (see [`AGENTS.md`](../AGENTS.md) for full details):

```bash
# Unit tests (all projects)
npx nx run-many -t test

# A single project
npx nx run @orion/<project>:test    # e.g. @orion/db, @orion/rag, @orion/web

# Orchestrator integration tests (Express API over in-memory PGlite)
npx nx run @orion/orchestrator:test

# Web E2E (Playwright, chromium only, mocked API)
npx playwright install chromium
npx nx run web-e2e:e2e

# Typecheck + lint (all projects)
npx nx run-many -t typecheck lint

# Build the web app
npx nx run @orion/web:build
```

Every PR must pass `test`, `typecheck`, and `lint`.

## Code style

- TypeScript throughout; formatting is enforced by Prettier and ESLint.
- Follow existing patterns in neighboring files — check imports and conventions
  before introducing new libraries.
- Keep the engine deterministic: the DAG scheduler must never call a model
  directly. Provider-specific logic belongs behind a category adapter.

## Commit and PR guidelines

- Write clear commit messages in the imperative mood ("Add X", "Fix Y").
- Keep pull requests scoped to a single concern where possible.
- Never commit secrets. `.env` is git-ignored; use `.env.example` for new keys.
- Reference issues with `Closes #123` in the PR description.

## Reporting bugs and requesting features

Use the [issue templates](https://github.com/aavanzyl/orion/issues/new/choose).
For security issues, follow [SECURITY.md](SECURITY.md) — do **not** open a public
issue.

## Code of Conduct

By participating, you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).
