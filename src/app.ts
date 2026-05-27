import cron from "node-cron";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { PushConnector } from "./connectors/push.connector";
import { SitecoreSearchConnector } from "./connectors/sitecore-search.connector";
import { SitemapConnector } from "./connectors/sitemap.connector";
import type { UrlSource } from "./types/connector.types";
import type { SitemapConfig } from "./types/config.types";
import { loadConfig } from "./config/config.loader";
import { loadEnv } from "./config/env";
import { scanSection } from "./core/scanner";
import { generateScanReportHtml } from "./report/generate-scan-html";
import type { ScanReport, ScanSectionReport } from "./types/scan-report.types";
import type { ValidationFinding } from "./types/validation.types";
import { logger } from "./utils/logger";
import { validate as validateCoverage } from "./validators/coverage.validator";
import { validate as validateMissingUrls } from "./validators/missing-url.validator";

export async function runScan(configPathArg?: string): Promise<ScanReport> {
  const startedAt = Date.now();
  const env = loadEnv();
  const configPath = resolveConfigPath(configPathArg);
  const config = loadConfig(configPath);

  logger.info(
    {
      targetName: config.name,
      environment: config.environment,
      configPath,
      sectionCount: config.search.sections.length,
    },
    "Scan started",
  );

  const sectionReports: ScanSectionReport[] = [];

  for (const section of config.search.sections) {
    const sitemapConnector = createSitemapUrlSource(config.sitemap);
    const searchConnector = new SitecoreSearchConnector(config.search, section);
    const comparison = await scanSection({
      section,
      sitemapSource: sitemapConnector,
      indexedSource: searchConnector,
    });

    const coverageFindings = validateCoverage(comparison, config.thresholds, section.name);
    const missingUrlFindings = validateMissingUrls(comparison, section.name);
    const findings = [...coverageFindings, ...missingUrlFindings];

    sectionReports.push({
      section: section.name,
      comparison,
      findings,
    });
  }

  const report: ScanReport = {
    targetName: config.name,
    environment: config.environment,
    configPath,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    sections: sectionReports,
    findingCounts: countFindings(sectionReports),
  };

  const outputDir = resolve(env.OUTPUT_DIR || config.output.dir);
  writeReport(outputDir, report);
  purgeOldReports(outputDir, config.output.retainDays);

  logger.info(
    {
      outputDir,
      durationMs: report.durationMs,
      findings: report.findingCounts,
    },
    "Scan completed",
  );

  return report;
}

export function scheduleScan(schedule: string): void {
  cron.schedule(schedule, () => {
    void runScan().catch((error: unknown) => {
      logger.error({ error }, "Scheduled scan failed");
    });
  });
}

if (require.main === module) {
  const configPathArg = parseConfigArg(process.argv);
  void runScan(configPathArg)
    .then((report) => {
      const allFindings = report.sections.flatMap((s) => s.findings);
      const criticalCount = allFindings.filter((f) => f.severity === "critical").length;
      const warningCount = allFindings.filter((f) => f.severity === "warning").length;

      if (criticalCount > 0) {
        const criticals = allFindings.filter((f) => f.severity === "critical");
        for (const f of criticals) {
          logger.error(
            { section: f.section, code: f.code, subtype: f.subtype, message: f.message, value: f.value },
            "Critical finding",
          );
        }
        logger.error({ criticalCount }, "Scan completed with critical findings");
        process.exit(1);
      }
      if (warningCount > 0) {
        logger.warn({ warningCount }, "Scan completed with warnings");
        process.exit(0);
      }
      logger.info("Scan completed successfully — all healthy");
      process.exit(0);
    })
    .catch((error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error({ err: { message: err.message, stack: err.stack } }, "Scan failed");
      process.exit(1);
    });
}

function parseConfigArg(argv: string[]): string | undefined {
  const flagIdx = argv.indexOf("--config");
  if (flagIdx !== -1 && argv[flagIdx + 1] && !argv[flagIdx + 1].startsWith("-")) {
    return argv[flagIdx + 1];
  }
  const positional = argv.slice(2).filter((a) => !a.startsWith("-") && a.endsWith(".json"));
  if (positional.length > 0) {
    return positional[positional.length - 1];
  }
  return undefined;
}

function createSitemapUrlSource(sitemap: SitemapConfig): UrlSource {
  const strategy = sitemap.fetchStrategy ?? "http";
  if (strategy === "push") {
    return new PushConnector(sitemap);
  }
  return new SitemapConnector(sitemap);
}

function resolveConfigPath(configPathArg?: string): string {
  if (configPathArg && configPathArg.trim().length > 0) {
    return resolve(configPathArg);
  }
  return resolve("config/example.config.json");
}

function countFindings(sectionReports: ScanSectionReport[]): Record<ValidationFinding["severity"], number> {
  const counts: Record<ValidationFinding["severity"], number> = {
    info: 0,
    warning: 0,
    critical: 0,
  };

  sectionReports.forEach((report) => {
    report.findings.forEach((finding) => {
      counts[finding.severity] += 1;
    });
  });

  return counts;
}

function writeReport(outputDir: string, report: ScanReport): void {
  mkdirSync(outputDir, { recursive: true });
  const safeTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const basename = `scan-report-${safeTimestamp}`;
  const jsonPath = join(outputDir, `${basename}.json`);
  const htmlPath = join(outputDir, `${basename}.html`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  writeFileSync(htmlPath, generateScanReportHtml(report), "utf8");
}

function purgeOldReports(outputDir: string, retainDays: number): void {
  const maxAgeMs = Math.max(0, retainDays) * 24 * 60 * 60 * 1000;
  if (maxAgeMs === 0) {
    return;
  }

  const now = Date.now();
  const files = readdirSync(outputDir, { withFileTypes: true });
  files
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith("scan-report-") &&
        (entry.name.endsWith(".json") || entry.name.endsWith(".html")),
    )
    .forEach((entry) => {
      const fullPath = join(outputDir, entry.name);
      const fileAgeMs = now - statSync(fullPath).mtimeMs;
      if (fileAgeMs > maxAgeMs) {
        rmSync(fullPath, { force: true });
      }
    });
}
