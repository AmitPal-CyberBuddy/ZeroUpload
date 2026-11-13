import { Icon, type IconName } from '../ui/Icon';
import {
  type Finding,
  type Insight,
  type Severity,
  countBySeverity,
  sortFindings,
  worstSeverity,
} from '../../lib/inspect/findings';

/**
 * The report a file scan produces, rendered once and used by every tool that
 * scans a file.
 *
 * Three decisions in here matter more than the styling:
 *
 *  - **Severity is in the heading.** "3 serious, 1 warning" is the first line, so
 *    a person who reads nothing else still learns the count and the weight.
 *  - **Every finding shows its evidence.** A row that says "tries to launch a
 *    program" is an accusation; the same row with `/Launch ×2` beside it is an
 *    observation someone can check. The evidence line is monospaced and never
 *    truncated mid-token without an ellipsis.
 *  - **The blind spots are visible.** The `limited` lines are rendered with the
 *    same prominence as findings, because "we could not read the compressed
 *    streams" changes how much the rest of the report means.
 */

const SEVERITY_META: Record<Severity, { icon: IconName; label: string; tone: string }> = {
  danger: { icon: 'alert', label: 'Serious', tone: 'danger' },
  warn: { icon: 'alert', label: 'Warning', tone: 'warn' },
  info: { icon: 'info', label: 'Note', tone: 'info' },
};

function FindingRow({ finding }: { finding: Finding }) {
  const meta = SEVERITY_META[finding.severity];
  return (
    <li className={`finding finding--${meta.tone}`}>
      <span className="finding__icon" aria-hidden="true">
        <Icon name={meta.icon} size={14} />
      </span>
      <div className="finding__body">
        <p className="finding__title">
          <span className="finding__severity">{meta.label}</span>
          {finding.title}
        </p>
        <p className="finding__detail">{finding.detail}</p>
        {finding.evidence ? (
          <p className="finding__evidence">
            <span className="finding__label">Evidence</span>
            <code>{finding.evidence}</code>
          </p>
        ) : null}
        {finding.advice ? <p className="finding__advice">{finding.advice}</p> : null}
      </div>
    </li>
  );
}

export function FindingList({ insight, title = 'Scan report' }: { insight: Insight; title?: string }) {
  const findings = sortFindings(insight.findings);
  const worst = worstSeverity(findings);
  const counts = countBySeverity(findings);

  if (findings.length === 0 && insight.limited.length === 0) return null;

  const heading =
    findings.length === 0
      ? 'Nothing matched'
      : [
          counts.danger ? `${counts.danger} serious` : '',
          counts.warn ? `${counts.warn} warning${counts.warn === 1 ? '' : 's'}` : '',
          counts.info ? `${counts.info} note${counts.info === 1 ? '' : 's'}` : '',
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <section className={`findings findings--${worst ?? 'none'}`} aria-label={title}>
      <div className="settings__head findings__head">
        <Icon name={worst === 'danger' ? 'alert' : 'shield'} size={13} />
        <span>{title}</span>
        <span className="findings__count">{heading}</span>
      </div>
      <div className="settings__body findings__body">
        {findings.length > 0 ? (
          <ul className="findings__list">
            {findings.map((finding) => (
              <FindingRow key={finding.id} finding={finding} />
            ))}
          </ul>
        ) : (
          <p className="findings__clean">
            Nothing in the bytes read matched a hazard pattern this site knows about. That is a structural
            check on the parts that could be read — not a security verdict.
          </p>
        )}

        {insight.limited.length > 0 ? (
          <div className="findings__limits">
            <p className="finding__label">What this scan could not see</p>
            <ul>
              {insight.limited.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The same findings, collapsed to one line — for a tool that has a small sidebar
 * slot rather than the inspector's full column.
 */
export function FindingSummary({ insight }: { insight: Insight }) {
  const worst = worstSeverity(insight.findings);
  if (!worst) return null;
  const meta = SEVERITY_META[worst];
  const first = sortFindings(insight.findings)[0];
  return (
    <p className={`finding-inline finding-inline--${meta.tone}`}>
      <Icon name={meta.icon} size={12} />
      <span>{first.title}</span>
    </p>
  );
}
