# Contributing

Thank you for helping improve Sitecore Search Integrity Monitor.

## Development setup

```bash
git clone https://github.com/YOUR_USERNAME/sitecore-search-integrity-monitor.git
cd sitecore-search-integrity-monitor
npm install
cp .env.example .env
```

Edit `.env` and set `SITECORE_SEARCH_API_KEY` to a valid Discover API key for your test environment.

Copy `config/example.config.json` to `config/local.config.json`, fill in your values, and run scans against that file. Do not commit real credentials or production config.

## Running tests

```bash
npm test
```

Unit tests use mocks and do not call live APIs. Integration tests under `tests/integration/` may call external services when enabled; read each file before running locally.

## Project structure

```
src/
  app.ts              Entry point: load config, run scan, write reports
  config/             Config loader and environment validation (Zod)
  connectors/         UrlSource implementations (sitemap, search, push)
  core/               Scan orchestration, URL normalization, set comparison
  validators/         Turn comparison results into findings (coverage, missing URLs)
  alerts/             Optional Teams / GitHub notification helpers
  report/             HTML report generation from scan results
  types/              Shared TypeScript types and Zod schemas
  utils/              Logging (Pino), retry, concurrency helpers
  api/                Push receiver HTTP server for push fetchStrategy
```

### UrlSource and connectors

Connectors implement the `UrlSource` interface:

```typescript
export interface UrlSource {
  getUrls(): Promise<string[]>;
}
```

- **SitemapConnector** — reads URLs from HTTP, local XML files, or a mix (index + sibling files).
- **SitecoreSearchConnector** — paginates the Discover API for one config section and returns indexed URLs.
- **PushConnector** — reads a URL list pushed from CI/CD into `push-cache/`.

The scanner pairs one sitemap source with one search source per section and compares the two sets.

### Validators

Validators take a `ComparisonResult` (and config thresholds where relevant) and return `ValidationFinding[]`. They do not fetch data; they only interpret comparison output. Add new rules as separate validator modules under `src/validators/`.

## Adding a new connector

1. Implement `UrlSource` in `src/connectors/your-connector.ts`.
2. Export `getUrls(): Promise<string[]>` that returns full canonical URLs.
3. Wire the connector in `src/app.ts` only if a new `fetchStrategy` or source type is required; otherwise extend an existing connector.
4. Add unit tests with mocked HTTP/filesystem dependencies.

## Adding a new validator

1. Accept `ComparisonResult` (and section name / thresholds as needed).
2. Return `ValidationFinding[]` with appropriate `severity`, `code`, and `message`.
3. Register the validator in `src/app.ts` alongside existing validators.
4. Add unit tests covering empty inputs, healthy coverage, and failure cases.

## Code standards

- **TypeScript** strict mode — match existing `tsconfig.json` settings.
- **Pino** for all logging — no `console.log` in production code paths.
- **Zod** for all external data validation (config files, env vars, API responses).
- Handle empty and null inputs gracefully; prefer early returns over throwing for expected empty sets.

## Pull request process

1. Fork the repo and create a feature branch from `main`.
2. Keep changes focused; avoid unrelated refactors.
3. Run `npm test` and ensure it passes.
4. Update README or config examples if you change user-facing behavior.
5. Open a PR with:
   - **Summary** — what changed and why
   - **Test plan** — commands run and results
   - **Breaking changes** — if any, call them out explicitly

Maintainers will review for correctness, test coverage, and alignment with the project's goal: generic Sitecore sitemap vs search integrity monitoring with no site-specific hardcoding in `src/`.
