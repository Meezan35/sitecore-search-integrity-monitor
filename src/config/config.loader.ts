import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { scanTargetConfigSchema, type ScanTargetConfig } from "../types/config.types";

const envTokenPattern = /^\$\{([A-Z0-9_]+)\}$/;

function resolveEnvTokens(value: unknown, filePath: string, path = ""): unknown {
  if (typeof value === "string") {
    const match = value.match(envTokenPattern);
    if (!match) {
      return value;
    }

    const envName = match[1];
    const envValue = process.env[envName];
    if (!envValue) {
      const fieldPath = path || "<root>";
      throw new Error(
        `Missing environment variable "${envName}" referenced at "${fieldPath}" in "${filePath}".`,
      );
    }
    return envValue;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => resolveEnvTokens(item, filePath, `${path}[${index}]`));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return Object.fromEntries(
      entries.map(([key, entryValue]) => {
        const nextPath = path ? `${path}.${key}` : key;
        return [key, resolveEnvTokens(entryValue, filePath, nextPath)];
      }),
    );
  }

  return value;
}

function formatValidationError(error: z.ZodError, filePath: string): string {
  const issues = error.issues.map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `- ${field}: ${issue.message}`;
  });

  return [`Config validation failed for "${filePath}":`, ...issues].join("\n");
}

export function loadConfig(filePath: string): ScanTargetConfig {
  let parsedJson: unknown;

  try {
    const raw = readFileSync(filePath, "utf8");
    parsedJson = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON in "${filePath}": ${message}`);
  }

  const resolvedConfig = resolveEnvTokens(parsedJson, filePath);
  const result = scanTargetConfigSchema.safeParse(resolvedConfig);

  if (!result.success) {
    throw new Error(formatValidationError(result.error, filePath));
  }

  return result.data;
}

export function loadConfigs(dirPath: string): ScanTargetConfig[] {
  const files = readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => join(dirPath, entry.name));

  return files.map((filePath) => loadConfig(filePath));
}
