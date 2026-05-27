import type {
  ComparisonResult,
  ThresholdConfig,
  ValidationFinding,
} from "../types/validation.types";

export function validate(
  result: ComparisonResult,
  thresholds: ThresholdConfig,
  sectionName: string,
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  if (result.coveragePercent < thresholds.criticalPercent) {
    findings.push({
      severity: "critical",
      code: "COVERAGE_BELOW_CRITICAL",
      message: `Coverage is ${result.coveragePercent}% which is below critical threshold ${thresholds.criticalPercent}%.`,
      section: sectionName,
      value: result.coveragePercent,
      threshold: thresholds.criticalPercent,
    });
  } else if (result.coveragePercent < thresholds.warningPercent) {
    findings.push({
      severity: "warning",
      code: "COVERAGE_BELOW_WARNING",
      message: `Coverage is ${result.coveragePercent}% which is below warning threshold ${thresholds.warningPercent}%.`,
      section: sectionName,
      value: result.coveragePercent,
      threshold: thresholds.warningPercent,
    });
  } else {
    findings.push({
      severity: "info",
      code: "COVERAGE_HEALTHY",
      message: `Coverage is healthy at ${result.coveragePercent}%.`,
      section: sectionName,
      value: result.coveragePercent,
      threshold: thresholds.warningPercent,
    });
  }

  Object.values(result.bySubtype).forEach((subtype) => {
    if (subtype.expectedCount > 0 && subtype.indexedCount === 0) {
      findings.push({
        severity: "critical",
        code: "SUBTYPE_COMPLETELY_MISSING",
        message: `Subtype "${subtype.subtype}" has 0 indexed URLs for ${subtype.expectedCount} expected.`,
        section: sectionName,
        subtype: subtype.subtype,
        value: subtype.indexedCount,
        threshold: 1,
      });
      return;
    }

    if (subtype.coveragePercent < thresholds.criticalPercent) {
      findings.push({
        severity: "critical",
        code: "SUBTYPE_COVERAGE_CRITICAL",
        message: `Subtype "${subtype.subtype}" coverage is ${subtype.coveragePercent}% (critical threshold: ${thresholds.criticalPercent}%).`,
        section: sectionName,
        subtype: subtype.subtype,
        value: subtype.coveragePercent,
        threshold: thresholds.criticalPercent,
      });
    }
  });

  return findings;
}
