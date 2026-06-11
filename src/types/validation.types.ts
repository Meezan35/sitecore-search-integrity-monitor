import type { ClassifiedUrl } from "../core/classify-missing";

export interface SubtypeCoverage {
  subtype: string;
  expectedCount: number;
  indexedCount: number;
  matchedCount: number;
  missingUrls: string[];
  coveragePercent: number;
}

export interface ComparisonResult {
  expectedCount: number;
  indexedCount: number;
  matchedCount: number;
  missingUrls: string[];
  unexpectedUrls: string[];
  coveragePercent: number;
  bySubtype: Record<string, SubtypeCoverage>;
  classifiedMissing: ClassifiedUrl[];
}

export interface ThresholdConfig {
  warningPercent: number;
  criticalPercent: number;
}

export interface ValidationFinding {
  severity: "info" | "warning" | "critical";
  code: string;
  message: string;
  section?: string;
  subtype?: string;
  value?: number;
  threshold?: number;
}
