/**
 * A single error shape for every tool. Tools throw `ToolError` so the shared UI
 * can render a title, an explanation and an optional recovery hint instead of a
 * raw stack trace.
 */
export type ToolErrorCode =
  | 'unsupported-type'
  | 'corrupt-file'
  | 'too-large'
  | 'limit-exceeded'
  | 'empty-input'
  | 'encoding-unsupported'
  | 'decode-failed'
  | 'worker-failed'
  | 'unsupported-browser'
  | 'encrypted'
  | 'invalid-input'
  | 'cancelled'
  | 'unknown';

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly hint?: string;

  constructor(code: ToolErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.hint = hint;
  }
}

export function toToolError(error: unknown): ToolError {
  if (error instanceof ToolError) return error;
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return new ToolError(
      'limit-exceeded',
      'The browser ran out of memory for this file.',
      'Close other tabs or try a smaller file.',
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ToolError('unknown', message || 'Something went wrong while processing this file.');
}

const SIZE_LIMITS = {
  image: 120 * 1024 * 1024,
  pdf: 200 * 1024 * 1024,
  zip: 400 * 1024 * 1024,
  text: 25 * 1024 * 1024,
} as const;

export type SizeCategory = keyof typeof SIZE_LIMITS;

/**
 * Guardrail against resource exhaustion. These are intentionally generous but
 * finite: decoding a 500 MB image will crash the tab on most devices, and a
 * crashed tab is worse than a clear error message.
 */
export function assertWithinSize(file: File, category: SizeCategory): void {
  const limit = SIZE_LIMITS[category];
  if (file.size > limit) {
    throw new ToolError(
      'too-large',
      `${file.name} is larger than the ${Math.round(limit / 1024 / 1024)} MB limit for this tool.`,
      'Processing stays in your browser, so very large files can exhaust memory. Try splitting the file first.',
    );
  }
  if (file.size === 0) {
    throw new ToolError('empty-input', `${file.name} is empty.`, 'Choose a file that has content.');
  }
}
