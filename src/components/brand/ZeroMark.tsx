import { useId } from 'react';

interface ZeroMarkProps {
  size?: number | string;
  /** Drawn arc indicates active work: the ring slowly closes. */
  active?: boolean;
  className?: string;
  title?: string;
}

/**
 * The ZeroUpload mark: an open ring (the zero) with a second, offset arc.
 * The gap is the "local boundary" — files go in, nothing goes up.
 */
export function ZeroMark({ size = 26, active = false, className, title }: ZeroMarkProps) {
  const id = useId().replace(/:/g, '');
  const gradientId = `zu-grad-${id}`;

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id={gradientId} x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="60%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--violet)" />
        </linearGradient>
      </defs>
      {/*
       * The starting angle is baked into the dash pattern rather than set with
       * `transform="rotate(...)"`.
       *
       * `.zero-ring` in `brand.css` animates rotation, which means it has to set
       * `transform-origin`. An author `transform-origin` beats the one implied by
       * a `rotate(a cx cy)` presentation attribute, so the attribute rotation was
       * being applied about (0,0) — the ring swung out of the 32x32 viewBox and
       * the mark rendered as two disconnected scraps. `stroke-dashoffset` rotates
       * the gap around the path instead, which is immune to that override and
       * needs no transform at rest, so the `zero-spin` animation can still drive
       * `transform` on its own without fighting anything.
       */}
      <circle
        cx="16"
        cy="16"
        r="11.2"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="55 15"
        strokeDashoffset={-6.2}
        className={active ? 'zero-ring zero-ring--active' : 'zero-ring'}
      />
      <path
        d="M16 7.4a8.6 8.6 0 0 1 0 17.2"
        fill="none"
        stroke="var(--accent)"
        strokeOpacity="0.32"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="1.6" fill="var(--accent)" />
    </svg>
  );
}

interface WordmarkProps {
  size?: number;
  className?: string;
}

/**
 * Large "0"-in-ZERO wordmark used in the hero. The letter O is replaced by the
 * live mark so the identity scales into the product.
 */
export function ZeroWordmark({ size = 1, className }: WordmarkProps) {
  return (
    <span
      className={['wordmark', className].filter(Boolean).join(' ')}
      style={size === 1 ? undefined : { fontSize: `${size}em` }}
      aria-hidden="true"
    >
      <span aria-hidden="true">ZER</span>
      <span className="wordmark__zero" aria-hidden="true">
        <ZeroMark size="1em" />
      </span>
      <span aria-hidden="true">UPLOAD</span>
    </span>
  );
}
