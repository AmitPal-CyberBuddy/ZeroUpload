/**
 * One vocabulary for "something about this file is worth telling you".
 *
 * Every scanner in this folder — PDF, archive, image, text — returns the same
 * `Finding` shape, and every surface renders it the same way. Before this, each
 * tool invented its own warnings: a `warnings: string[]` from the ZIP reader, a
 * `mismatch` boolean from the MIME sniffer, a red `Notice` written inline in a
 * component. They could not be ranked against each other, so "this file will run
 * code when opened" and "this file is larger than usual" arrived with the same
 * weight.
 *
 * Three rules keep the output honest, because a false accusation about a
 * legitimate invoice is a real cost:
 *
 *  1. **A finding names what was observed, not what it means.** "The byte stream
 *     contains /JavaScript" is a fact. "This file is malicious" is not something
 *     a byte scan can establish, so no finding says it.
 *  2. **Absence of a finding is not a clean bill of health.** Compressed object
 *     streams, encrypted containers and truncated reads are all blind spots, and
 *     each scanner reports its own `limited` reason rather than staying silent.
 *  3. **Severity is about consequence, not confidence.** `danger` means opening
 *     this file in the application that owns it can execute code or write outside
 *     the folder you chose; `warn` means something contradicts itself or carries
 *     known risk; `info` is context a careful person would want.
 */

export type Severity = 'danger' | 'warn' | 'info';

export interface Finding {
  /**
   * Stable id, namespaced by scanner (`pdf.launch`, `archive.traversal`).
   * Stable because the UI groups by it and tests assert on it.
   */
  id: string;
  severity: Severity;
  /** A few words: what was seen. Shown as the row heading. */
  title: string;
  /** One or two sentences: what it was found in, and why it matters. */
  detail: string;
  /** The literal evidence — a keyword, an entry name, a count. Never invented. */
  evidence?: string;
  /** What a person can do about it. Only where there is a real action. */
  advice?: string;
}

export interface Insight {
  findings: Finding[];
  /**
   * Reasons this scan could not see everything, in plain language. A scanner
   * that looked at 2 MB of a 40 MB file says so here.
   */
  limited: string[];
  /**
   * Tool slugs this specific file makes worth opening, most relevant first.
   * Drives the "Next steps" buttons, so it is narrowed by the findings rather
   * than by the file type alone.
   */
  next: NextStep[];
}

export interface NextStep {
  slug: string;
  label: string;
  /** Why *this* file makes this worth doing. One clause, not a sales line. */
  why: string;
}

export const SEVERITY_ORDER: Record<Severity, number> = { danger: 0, warn: 1, info: 2 };

/** Highest severity present, or `null` for a file with nothing to report. */
export function worstSeverity(findings: Finding[]): Severity | null {
  if (findings.length === 0) return null;
  return findings.reduce<Severity>(
    (worst, finding) => (SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[worst] ? finding.severity : worst),
    'info',
  );
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { danger: 0, warn: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/**
 * Sorted for display: most serious first, and stable within a severity so the
 * order a scanner reported is kept (it is already written in a sensible order).
 */
export function sortFindings(findings: Finding[]): Finding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity] || a.index - b.index)
    .map((entry) => entry.finding);
}

/** An empty result, so every scanner has one return shape. */
export function emptyInsight(limited: string[] = []): Insight {
  return { findings: [], limited, next: [] };
}

/** Severity label for a heading, e.g. "3 warnings". */
export function describeCounts(findings: Finding[]): string {
  const counts = countBySeverity(findings);
  const parts: string[] = [];
  if (counts.danger) parts.push(`${counts.danger} serious`);
  if (counts.warn) parts.push(`${counts.warn} warning${counts.warn === 1 ? '' : 's'}`);
  if (counts.info) parts.push(`${counts.info} note${counts.info === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
