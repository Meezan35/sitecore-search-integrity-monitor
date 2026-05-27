import type { ComparisonResult } from "./validation.types";
import type { ValidationFinding } from "./validation.types";

export interface ScanSectionReport {
  section: string;
  comparison: ComparisonResult;
  findings: ValidationFinding[];
}

export interface ScanReport {
  targetName: string;
  environment: string;
  configPath: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  sections: ScanSectionReport[];
  findingCounts: Record<ValidationFinding["severity"], number>;
}
