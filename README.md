# Sitecore Search Integrity Monitor

Detects silent content indexing gaps between your Sitecore XM Cloud sitemap and Sitecore Search (Discover). Compares every URL in your sitemap against what is actually indexed — reports missing pages, stale indexed URLs, and per-section coverage percentages.

Built for any Sitecore XM Cloud + Sitecore Search site. Configurable for any content structure — products, blogs, people, courses, or any custom sections.

## How it works

1. Reads all URLs from your Sitecore sitemap (including sitemap index files)
2. Fetches all indexed URLs from your Sitecore Search widgets via the Discover API
3. Compares both sets — reports missing, unexpected, and coverage % per section and per content type

## Prerequisites

- Node.js 18+
- A Sitecore XM Cloud site with Sitecore Search (Discover) enabled
- Your Sitecore Search API key (the `01-` prefixed key)

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/sitecore-search-integrity-monitor
cd sitecore-search-integrity-monitor
npm install
```

### 2. Create your config

```bash
cp config/example.config.json config/mysite.config.json
```

Open `config/mysite.config.json` and fill in:

- Your account ID (from your Discover API URL)
- Your widget IDs (from browser DevTools)
- Your source IDs (from browser DevTools)
- Your URL patterns
- Your sitemap URL

### 3. Set your API key

Create a `.env` file (see `.env.example`):

```bash
SITECORE_SEARCH_API_KEY=your-01-prefixed-key-here
```

### 4. Download your sitemaps (if your site has bot protection)

```bash
mkdir -p sitemaps/mysite
curl https://www.yoursite.com/sitemap.xml -o sitemaps/mysite/sitemap-index.xml
curl https://www.yoursite.com/sitemap-1.xml -o sitemaps/mysite/sitemap-1.xml
```

Then set `fetchStrategy: "file"` and `localFilePath` in your config.

If your sitemap is publicly accessible, set `fetchStrategy: "http"` and skip this step.

### 5. Run your first scan

```bash
npm run scan -- --config config/mysite.config.json
```

Expected output: coverage percentages per section, missing URL count, HTML report saved to `output/`.

## Finding your widget IDs and source IDs

Every value you need is visible in your browser DevTools:

1. Open your site in Chrome
2. Open DevTools → Network tab
3. Trigger a search on one of your search pages
4. Find the POST request to `discover.sitecorecloud.io`
5. Click it → Payload tab

In the payload you will see:

```json
"rfk_id": "rfkid_your_widget_id"
"sources": ["123456", "789012"]
```

- `rfk_id` → your `widgetId`
- `sources` → your `sources` array

Your account ID is the number in the URL:

`discover.sitecorecloud.io/discover/v2/YOUR_ACCOUNT_ID_IS_HERE`

Repeat this for each search page you want to monitor.

## Config reference

### Scan target (`ScanTargetConfig`)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | — | Display name for this site in reports and logs |
| `environment` | `"production"` \| `"staging"` \| `"qa"` | yes | — | Environment label attached to scan results |
| `sitemap` | object | yes | — | How sitemap URLs are loaded (see below) |
| `search` | object | yes | — | Sitecore Discover API and per-section widgets |
| `thresholds` | object | yes | — | Coverage alert thresholds (percent) |
| `output` | object | yes | — | Report output directory and retention |

### Sitemap (`SitemapConfig`)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | yes | — | Root sitemap URL (`http`/`file`) or placeholder when using `push` |
| `fetchStrategy` | `"http"` \| `"file"` \| `"push"` | no | `"http"` | How to obtain sitemap URLs |
| `localFilePath` | string | when `file` | — | Path to downloaded sitemap XML (index or urlset) |
| `stripLocale` | boolean | yes | — | Strip locale path prefixes before URL matching |
| `locales` | string[] | no | `[]` | Locale codes to include when sitemap has multiple languages |
| `delayBetweenRequestsMs` | number | no | `1500` | Pause between sequential sitemap HTTP requests |
| `childSitemapUrls` | string[] | no | — | (`http`) Skip root fetch; fetch each URL as a child sitemap |
| `pushSource` | string | when `push` | — | Cache key; must match `source` in push payload |
| `pushMaxAgeHours` | number | no | `25` | Abort scan if push cache is older than this |
| `fetch` | object | no | — | Optional HTTP tuning (see below) |

### Sitemap HTTP tuning (`SitemapFetchConfig`, under `sitemap.fetch`)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `initialDelayMs` | number | no | — | Pause before the first sitemap HTTP request |
| `retries` | number | no | — | Max attempts per URL (including first try) |
| `baseDelayMs` | number | no | `1000` | Base delay for exponential backoff between retries |
| `maxDelayMs` | number | no | `10000` | Cap on retry wait time |
| `timeoutMs` | number | no | — | Per-request timeout |
| `userAgent` | string | no | — | Override default User-Agent |
| `referer` | string | no | — | Same-site Referer for strict WAFs |

### Search (`search`)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `apiUrl` | string (URL) | yes | — | Discover v2 base URL including account ID |
| `apiKey` | string | yes | — | API key or `${ENV_VAR}` token resolved at runtime |
| `pageSize` | number | no | `100` | Requested page size per Discover call (API caps at 100) |
| `sections` | array | yes | — | One entry per monitored search widget / content area |

### Section (`SectionConfig`, each item in `search.sections`)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | — | Friendly section label in reports |
| `widgetId` | string | yes | — | Sitecore Search widget ID (`rfk_id` from DevTools) |
| `sources` | string[] | yes | — | Source IDs from Discover POST payload |
| `urlPatterns` | string[] | yes | — | URL path prefixes that belong to this section |
| `subtypeField` | string | yes | — | Field name for content subtype grouping in reports |
| `urlField` | string | yes | — | Field containing canonical page URL in index records |
| `entity` | string | yes | — | Discover entity name in request body |
| `locale.country` | string | yes | — | Country code sent to Discover |
| `locale.language` | string | yes | — | Language code sent to Discover |

### Thresholds and output

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `thresholds.warningPercent` | number | no | `90` | Amber alert when coverage falls below this |
| `thresholds.criticalPercent` | number | no | `50` | Red alert when coverage falls below this |
| `output.dir` | string | yes | — | Directory for JSON/HTML reports |
| `output.retainDays` | number | yes | — | Delete reports older than this many days |

Keys starting with `_comment` in JSON configs are ignored by the loader and exist for documentation only.

## Sitemap access

### If your site returns 429 errors

Your site likely uses Vercel or Cloudflare bot protection. Node.js HTTP clients cannot solve the JavaScript challenge these services issue.

**Option A — Use local files (recommended for development)**

Download sitemaps manually and set `fetchStrategy: "file"`. Re-download when content changes significantly.

**Option B — Whitelist your monitoring server IP**

- Vercel: Project Settings → Security → Bot Protection → IP Allowlist
- Cloudflare: Security → WAF → Tools → IP Access Rules

This is the best solution for automated CI/CD monitoring.

**Option C — Commit sitemaps to your repo**

For CI/CD when IP whitelisting is not possible. Add a step to re-download sitemaps on a weekly schedule.

### Push strategy (`fetchStrategy: "push"`)

When HTTP and file strategies are impractical, run `npm run push-server` and POST your URL list from CI/CD. See `docs/ci-push-example.yml` for a workflow sample. Set `pushSource` to match the `source` field in your push payload.

## Automated monitoring with GitHub Actions

### Setup

1. Add your workflow file to `.github/workflows/daily-scan.yml` (copy from this repo's workflow as a starting point).
2. Add secrets to your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**
   - `SITECORE_SEARCH_API_KEY` — your `01-` prefixed API key
   - `TEAMS_WEBHOOK_URL` — Teams incoming webhook URL (optional)
3. Update the workflow to point to your config file.
4. Trigger a manual run from the Actions tab to verify.

### Getting a Teams webhook URL

1. Open Teams → go to your channel or chat
2. Click **...** → **Workflows**
3. Search **Send webhook alerts to a channel**
4. Follow setup steps → copy the webhook URL

## Understanding results

### Coverage percentage

`(expected ∩ indexed) / expected × 100`

A URL is **expected** if it appears in your sitemap and matches the section's `urlPatterns`. A URL is **indexed** if it is returned by the Sitecore Search widget for that section.

### Missing URLs

In your sitemap but **not** in the search index. These pages exist on your site but will not appear in search results.

### Unexpected URLs

In the search index but **not** in your sitemap. Often deleted pages still indexed, or pages with wrong URLs stored in the search index.

### Coverage thresholds

- `warningPercent` (default 90%) — amber alert, worth investigating
- `criticalPercent` (default 50%) — red alert, search is significantly broken

## Troubleshooting

| Problem | Likely cause | Fix |
|---------|-------------|-----|
| 429 on sitemap | Bot protection | Use `fetchStrategy: file` or whitelist your IP |
| 0% coverage | URL normalization mismatch | Check debug logs for URL samples from both sides |
| 0 results from search | Wrong `widgetId` or `sources` | Verify in DevTools network tab |
| `total_item` missing | Wrong account ID in API URL | Check the number in your `apiUrl` |
| Search returns wrong content | Wrong `sources` array | Each widget/source combination is unique per environment |

Set `LOG_LEVEL=debug` when running a scan to log normalized URL samples from sitemap vs search for each section.

## Adding a new section

Add an entry to `search.sections` in your config:

```json
{
  "name": "Your Section",
  "widgetId": "rfkid_your_widget",
  "sources": ["your_source_id"],
  "urlPatterns": ["/your-path"],
  "subtypeField": "type",
  "urlField": "url",
  "entity": "content",
  "locale": { "country": "us", "language": "en" }
}
```

No code changes needed.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
