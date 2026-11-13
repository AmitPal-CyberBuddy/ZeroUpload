import { useEffect, useState } from 'react';

import { Icon } from '../ui/Icon';
import { type Finding } from '../../lib/inspect/findings';
import { endsWithEndMarker, formatOf, scanImageBytes } from '../../lib/inspect/image';

/**
 * What an image's own bytes say, shown before it is re-encoded.
 *
 * Every image tool here decodes and re-encodes, which silently discards anything
 * appended after the end of the picture and bakes in an EXIF rotation. Both are
 * worth saying *before* the run, not after: "the output is 40 kB smaller" is a
 * different sentence when 12 kB of it was a hidden archive.
 *
 * Two reads only — 64 bytes from the head and 16 from the tail — so this costs
 * nothing on a 40 MP photograph. The full structural scan is deliberately not
 * used here: it is the inspector's job to be thorough, and a tool page should
 * stay quick enough to feel like a tool.
 */
export function ImageChecks({ file }: { file: File }) {
  const [state, setState] = useState<{ findings: Finding[]; trailing: number; limited: string[] } | null>(null);

  useEffect(() => {
    let active = true;
    setState(null);
    void (async () => {
      try {
        const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
        const format = formatOf(head);
        if (!format) return;
        const findings: Finding[] = [];
        const limited: string[] = [];
        let trailing = 0;

        if (format === 'jpeg' || format === 'png' || format === 'gif') {
          const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 16)).arrayBuffer());
          if (tail.length < file.size && !endsWithEndMarker(format, tail)) {
            /*
             * The marker is missing, which means either data was appended or the
             * file was cut short. Distinguishing them needs a full walk, so the
             * wording covers both instead of guessing.
             */
            findings.push({
              id: 'image.unterminated',
              severity: 'warn',
              title: 'Data after the end of the picture',
              detail:
                'The file does not finish with the end-of-image marker, so there are bytes after the picture or the file was truncated. Re-encoding here writes a clean file and drops whatever is at the end.',
              evidence: `last bytes ${[...tail.subarray(Math.max(0, tail.length - 4))].map((byte) => byte.toString(16).padStart(2, '0')).join(' ')}`,
            });
          }
        }

        // The declared dimensions are not needed for these checks; the header
        // walk inside the scanner reports anything structural on its own.
        const insight = scanImageBytes(head, undefined);
        for (const finding of insight.findings) {
          if (finding.id === 'image.exif-orientation' || finding.id === 'image.animated') findings.push(finding);
        }
        limited.push(...insight.limited);

        if (findings.length === 0 && limited.length === 0) {
          // Nothing to say is a valid outcome, and the caller renders nothing.
          if (!active) return;
          setState({ findings: [], trailing, limited: [] });
          return;
        }
        if (!active) return;
        setState({ findings, trailing, limited });
      } catch {
        /* a checks panel is a bonus; failing to build one must not block a tool */
      }
    })();
    return () => { active = false; };
  }, [file]);

  if (!state || state.findings.length === 0) return null;

  return (
    <div className="image-checks">
      {state.findings.map((finding) => (
        <p key={finding.id} className={`image-checks__row image-checks__row--${finding.severity}`}>
          <Icon name={finding.severity === 'info' ? 'info' : 'alert'} size={13} />
          <span>
            <strong>{finding.title}.</strong> {finding.detail}
          </span>
        </p>
      ))}
      {state.limited.map((line) => (
        <p key={line} className="image-checks__row image-checks__row--info">
          <Icon name="info" size={13} />
          <span>{line}</span>
        </p>
      ))}
    </div>
  );
}
