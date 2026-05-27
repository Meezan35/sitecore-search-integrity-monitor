import type { ComparisonResult, ValidationFinding } from "../types/validation.types";

export function validate(result: ComparisonResult, sectionName: string): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  Object.values(result.bySubtype).forEach((subtypeCoverage) => {
    const missingCount = subtypeCoverage.missingUrls.length;
    if (missingCount === 0) {
      return;
    }

    let severity: ValidationFinding["severity"] = "info";
    if (missingCount > 100) {
      severity = "critical";
    } else if (missingCount > 10) {
      severity = "warning";
    }

    findings.push({
      severity,
      code: "MISSING_URLS_BY_SUBTYPE",
      message: `${missingCount} missing URLs detected for subtype "${subtypeCoverage.subtype}".`,
      section: sectionName,
      subtype: subtypeCoverage.subtype,
      value: missingCount,
    });
  });

  if (result.unexpectedUrls.length > 0) {
    findings.push({
      severity: "info",
      code: "UNEXPECTED_URLS_FOUND",
      message: `${result.unexpectedUrls.length} unexpected indexed URLs found outside sitemap expectations.`,
      section: sectionName,
      value: result.unexpectedUrls.length,
    });
  }

  return findings;
}
