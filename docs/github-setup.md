# GitHub Actions Setup

## How the workflow runs

The workflow runs **`config/production.config.json`** with **`fetchStrategy: "http"`**.

Sitemaps are downloaded fresh on every run using the Vercel Protection Bypass Secret,
which allows the GitHub Actions runner to bypass bot protection on Vercel-hosted sites.

## Required secrets

Add these in: **GitHub repo → Settings → Secrets and variables → Actions**

| Secret | Value | Required |
|--------|-------|----------|
| `SITECORE_SEARCH_API_KEY` | Your `01-` prefixed Sitecore Search API key | Yes |
| `TEAMS_WEBHOOK_URL` | Webhook URL from Microsoft Teams Workflows | Yes |
| `VERCEL_BYPASS_SECRET` | Protection bypass secret from Vercel dashboard | Yes if site uses Vercel bot protection |

## How to get each secret

### SITECORE_SEARCH_API_KEY
Your Sitecore Search (Discover) API key — the `01-` prefixed key found in your
Sitecore Search dashboard or existing `.env` file.

### TEAMS_WEBHOOK_URL
1. Open Microsoft Teams
2. Go to the channel or chat where you want alerts
3. Click **...** → **Workflows**
4. Search for **Send webhook alerts to a channel**
5. Follow setup steps → copy the webhook URL
6. Paste it as the `TEAMS_WEBHOOK_URL` secret in GitHub

### VERCEL_BYPASS_SECRET
Only needed if your site is hosted on Vercel with bot protection enabled.

1. Go to your Vercel dashboard
2. Select your project
3. Click **Settings** → **Deployment Protection**
4. Find **Protection Bypass for Automation**
5. Copy the existing secret or generate a new one
6. Paste it as the `VERCEL_BYPASS_SECRET` secret in GitHub

If your site does not use Vercel bot protection, remove the
`x-vercel-protection-bypass` header from the sitemap download
step in `.github/workflows/daily-scan.yml`.

## Sitemap download

The workflow downloads sitemaps fresh on every run:

```yaml
- name: Download sitemaps
  env:
    VERCEL_BYPASS_SECRET: ${{ secrets.VERCEL_BYPASS_SECRET }}
  run: |
    mkdir -p sitemaps/yoursite
    curl -f -s "https://www.yoursite.com/sitemap.xml" \
      -H "x-vercel-protection-bypass: $VERCEL_BYPASS_SECRET" \
      -H "User-Agent: Mozilla/5.0" \
      -o sitemaps/yoursite/sitemap-index.xml
```

### If your site does not use Vercel
Remove the `-H "x-vercel-protection-bypass: ..."` line entirely.
The plain curl command will work for publicly accessible sitemaps.

### If you still get 429 errors
Your WAF or CDN may use a different bypass mechanism.
Options:
- Add your GitHub Actions IP ranges to your WAF allowlist
- Use `fetchStrategy: "file"` and commit sitemaps to the repo
  (re-download manually whenever content changes significantly)

## How to run manually

1. Go to your GitHub repo
2. Click the **Actions** tab
3. Click **Daily Search Integrity Scan** in the left sidebar
4. Click **Run workflow** (top right)
5. Confirm with the green **Run workflow** button
6. Watch the run — a Teams notification arrives within ~2 minutes

## Viewing reports

After each run:

1. Open the completed workflow run
2. Scroll to the **Artifacts** section at the bottom
3. Download **scan-report-{run_id}** for the HTML report
4. Download **scan-data-{run_id}** for the raw JSON

Reports are retained for:
- HTML reports: 30 days
- JSON reports: 90 days

## Teams notification

The workflow compiles TypeScript (`npm run build`), then runs
`node dist/alerts/github-teams-notify.js`.

The POST uses only Node.js built-in `https` — no extra npm packages.
The Teams MessageCard payload is built by `buildTeamsPayload` in
`src/alerts/teams.payload.ts` and is covered by unit tests.

If the webhook call fails, the step exits successfully so the overall
workflow status reflects the scan result, not Teams connectivity.

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| 429 on sitemap download | Bot protection blocking GitHub IPs | Add `VERCEL_BYPASS_SECRET` or use IP allowlist |
| Scan config not found | Wrong config path in workflow | Check `--config` path in `daily-scan.yml` |
| Teams notification not sent | Wrong webhook URL | Verify `TEAMS_WEBHOOK_URL` secret in GitHub |
| 0 URLs from search | Wrong API key | Verify `SITECORE_SEARCH_API_KEY` secret |
| Scan exits with code 1 | Critical findings detected | Check the HTML report for details |