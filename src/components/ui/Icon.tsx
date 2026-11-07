import type { SVGProps } from 'react';

/**
 * Geometric 24px icon set drawn on a 1.5px grid. Kept local (no icon font, no
 * runtime icon package) so the icon language stays consistent and the bundle
 * stays small.
 */
const PATHS = {
  'arrow-right': 'M4 12h15M13 6l6 6-6 6',
  'arrow-down': 'M12 4v15M6 13l6 6 6-6',
  'arrow-up-right': 'M7 17 17 7M8 7h9v9',
  'arrow-left': 'M20 12H5M11 6l-6 6 6 6',
  check: 'M4.5 12.5 9.5 17.5 19.5 6.5',
  x: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  download: 'M12 3v12M7 10l5 5 5-5M4 20h16',
  file: 'M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6Z M13 3v6h6',
  files: 'M9 2h6l5 5v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z M4 7v13a2 2 0 0 0 2 2h9',
  image:
    'M4 5h16v14H4z M4 16l4.5-4.5 3.5 3.5 3-3L20 17 M15.5 9.5a1 1 0 1 0 0-.01',
  compress: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14 M2 6h14a2 2 0 0 1 2 2v14',
  resize: 'M4 4h9v9H4z M15 15h5v5h-5 M15 9h5M9 15v5',
  rotate: 'M20 7v5h-5 M20 12a8 8 0 1 0-2.4 5.7',
  flip: 'M12 3v18 M9 7 4 12l5 5V7Z M15 7l5 5-5 5V7Z',
  pdf: 'M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6Z M13 3v6h6 M9 17v-4h1.5a1 1 0 0 1 0 2H9 M14 17v-4h1.2a2 2 0 0 1 0 4H14',
  zip: 'M6 3h12v18H6z M10 3v3h4V3 M12 7v2 M12 11v2 M12 15v2 M10 19h4',
  inspect: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM16 16l5 5 M10.5 7.5v3.5l2.5 2',
  hash: 'M9 3 7 21M17 3l-2 18M4 8h16M3 16h16',
  code: 'M9 8l-5 4 5 4M15 8l5 4-5 4',
  braces: 'M8 3H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2 M16 3h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2',
  link: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1 M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1',
  shield: 'M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z M9 12l2 2 4-4',
  lock: 'M6 11h12v10H6z M9 11V7a3 3 0 0 1 6 0v4',
  cpu: 'M8 8h8v8H8z M4 10h2M4 14h2M18 10h2M18 14h2M10 4v2M14 4v2M10 18v2M14 18v2',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z M19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16Z',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M6 6 4.5 4.5M19.5 19.5 18 18M6 18l-1.5 1.5M19.5 4.5 18 6M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  moon: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z',
  github:
    'M9 19c-4 1.3-4-2.2-5.5-2.8M15 22v-3.4a3 3 0 0 0-.8-2.3c2.7-.3 5.5-1.3 5.5-6a4.7 4.7 0 0 0-1.3-3.2 4.4 4.4 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.4 0C5.9 3.6 4.8 3.9 4.8 3.9a4.4 4.4 0 0 0-.1 3.2A4.7 4.7 0 0 0 3.4 10.3c0 4.7 2.8 5.7 5.5 6a3 3 0 0 0-.8 2.3V22',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8v.01',
  alert: 'M12 3 2.5 20h19L12 3ZM12 9v5M12 17v.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  layers: 'M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5M3 17.5l9 5 9-5',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  terminal: 'M4 4h16v16H4z M8 9l3 3-3 3M13 15h4',
  refresh: 'M20 5v5h-5M4 19v-5h5M19.5 10a7.5 7.5 0 0 0-13-3.4L4 9M4.5 14a7.5 7.5 0 0 0 13 3.4L20 15',
  menu: 'M4 7h16M4 12h16M4 17h16',
  copy: 'M9 9h10v12H9zM5 15H3V3h12v2',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 4v6M8 14v6',
  chevron: 'M9 6l6 6-6 6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  scissors: 'M6 6a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM6 13a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM8 10.5 20 3M8 13.5 20 21',
  wand: 'M15 4l1.2 3.3L19.5 8.5l-3.3 1.2L15 13l-1.2-3.3L10.5 8.5l3.3-1.2L15 4ZM4 20l8-8',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.4 3.8 5.4 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.4-3.8-9S9.5 5.4 12 3Z',
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number | string;
  strokeWidth?: number;
}

export function Icon({ name, size = 18, strokeWidth = 1.5, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
