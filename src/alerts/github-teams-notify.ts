/**
 * CI/local entry: read latest scan JSON from OUTPUT_DIR, build Teams MessageCard, POST webhook.
 * Uses only Node.js built-in modules for HTTP (no axios).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as https from "node:https";
import { URL } from "node:url";

import { buildTeamsPayload, type ScanRecord } from "./teams.payload";

function findLatestScanJson(dir: string): string | null {
  if (!fs.existsSync(dir)) {
    return null;
  }
  const files = fs
    .readdirSync(dir)
    .filter((n) => n.startsWith("scan-report-") && n.endsWith(".json"));
  if (files.length === 0) {
    return null;
  }
  let best = files[0]!;
  let bestM = fs.statSync(path.join(dir, best)).mtimeMs;
  for (const f of files) {
    const m = fs.statSync(path.join(dir, f)).mtimeMs;
    if (m > bestM) {
      best = f;
      bestM = m;
    }
  }
  return path.join(dir, best);
}

function postJson(webhookUrl: string, body: object): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(webhookUrl);
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(payload.length),
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          if (res.statusCode !== undefined && res.statusCode >= 400) {
            reject(new Error(`Teams webhook HTTP ${res.statusCode}`));
          } else {
            resolve();
          }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function main(): Promise<void> {
  const webhook = process.env.TEAMS_WEBHOOK_URL;
  const repoUrl = process.env.GITHUB_REPO_PUBLIC_URL;
  const runId = process.env.GITHUB_RUN_ID;
  const outDir = process.env.OUTPUT_DIR ?? "output";

  if (!webhook || webhook.trim().length === 0) {
    console.warn("TEAMS_WEBHOOK_URL is not set — skipping Teams notification.");
    return;
  }
  if (!repoUrl || !runId) {
    console.warn("GITHUB_REPO_PUBLIC_URL or GITHUB_RUN_ID missing — skipping Teams notification.");
    return;
  }

  const latestPath = findLatestScanJson(outDir);
  let scan: ScanRecord | null = null;
  if (latestPath) {
    try {
      scan = JSON.parse(fs.readFileSync(latestPath, "utf8")) as ScanRecord;
    } catch {
      scan = null;
    }
  }

  const card = buildTeamsPayload(scan, repoUrl, runId);
  await postJson(webhook, card);
  console.log("Teams notification sent successfully.");
}

void main().catch((err: unknown) => {
  console.error("Teams notification failed:", err);
});
