/**
 * Cumulative budgets for operations that take **several inputs at once**.
 *
 * `assertWithinSize` (errors.ts) guards a single file. A single-file guard is
 * not a guard for a batch: forty 150 MB PDFs each pass their own check and then
 * ask the tab for 6 GB. These helpers make the whole-operation ceiling explicit,
 * always from metadata (`File.size`, `ArrayBuffer.byteLength`) so nothing is
 * read or allocated before the decision.
 *
 * All failures are `ToolError`s with the existing codes:
 *
 *   - `too-large`     — one input is too big; the caller should have thrown this
 *                       already via `assertWithinSize`.
 *   - `limit-exceeded` — a count, a cumulative size, or an output page ceiling.
 *
 * Nothing here imports a processing library, so it is cheap to use from the
 * React layer *before* reading any file bytes.
 */
import { ToolError } from './errors';
import { formatBytes } from './format';

export interface BudgetInput {
  name: string;
  size: number;
}

export interface OperationBudget {
  /** Plural noun used in messages: "PDFs", "images", "files". */
  noun: string;
  /** Cumulative input ceiling for one operation. */
  maxBytes: number;
  /** How many inputs one operation may take. */
  maxItems?: number;
  /** Output page ceiling, where the operation produces pages. */
  maxPages?: number;
  /** Recovery advice shown under the error in the UI. */
  hint?: string;
}

/**
 * One entry per multi-input operation. Numbers are deliberately generous but
 * finite, and small enough that peak memory stays inside a normal tab:
 * pdf-lib holds a parsed document *and* its saved output at the same time.
 */
export const OPERATION_BUDGETS = {
  pdfMerge: {
    noun: 'PDFs',
    maxBytes: 250 * 1024 * 1024,
    maxItems: 50,
    maxPages: 3_000,
    hint: 'Merging parses every document at once. Merge in two passes instead.',
  },
  imagesToPdf: {
    noun: 'images',
    maxBytes: 150 * 1024 * 1024,
    maxItems: 200,
    maxPages: 200,
    hint: 'Build the document in two passes instead — the PDFs can be merged afterwards.',
  },
  zipCreate: {
    noun: 'files',
    maxBytes: 512 * 1024 * 1024,
    maxItems: 2_000,
    hint: 'Split the bundle into several archives.',
  },
  /**
   * Encrypted archives are a quarter of the plain-ZIP budget on purpose.
   *
   * Measured (docs/v2-proofs.md): AES-256 through zip.js cost +188 MB of resident
   * memory for 50 MB of incompressible input — about 3.8× — because the writer
   * holds every entry, the AES state and the output blob at once, where fflate
   * streams into a single buffer. 128 MB of input would therefore ask a phone for
   * roughly half a gigabyte; 64 MB keeps the peak near a quarter of that.
   */
  zipCreateEncrypted: {
    noun: 'files',
    maxBytes: 64 * 1024 * 1024,
    maxItems: 500,
    hint: 'Encrypting needs far more working space than a plain archive. Split the bundle into smaller parts, or create the ZIP without a password.',
  },
} as const satisfies Record<string, OperationBudget>;

export function totalSize(inputs: readonly BudgetInput[]): number {
  let total = 0;
  for (const input of inputs) total += input.size;
  return total;
}

/**
 * Enforces item count and cumulative bytes. Call this with `File`-like objects
 * or `{ name, size }` literals — it only ever reads `.size`.
 */
export function assertCumulativeBudget(inputs: readonly BudgetInput[], budget: OperationBudget): void {
  if (inputs.length === 0) {
    throw new ToolError('empty-input', `Add at least one input to process.`);
  }

  if (budget.maxItems !== undefined && inputs.length > budget.maxItems) {
    throw new ToolError(
      'limit-exceeded',
      `One operation can take at most ${budget.maxItems.toLocaleString()} ${budget.noun}.`,
      budget.hint,
    );
  }

  const total = totalSize(inputs);
  if (total > budget.maxBytes) {
    throw new ToolError(
      'limit-exceeded',
      `These ${budget.noun} total ${formatBytes(total)} together.`,
      budget.hint ?? `One operation is limited to ${formatBytes(budget.maxBytes)} of input.`,
    );
  }
}

/**
 * A batch is one user action over many files, so it needs its own ceiling on top
 * of the per-item and per-operation budgets. `maxOutputBytes` bounds what is held
 * in memory at once: results stay as `Blob`s until the user downloads or releases
 * them, and the queue pauses rather than quietly dropping data.
 */
export interface BatchBudget extends OperationBudget {
  /** Cumulative bytes of results held simultaneously by one batch. */
  maxOutputBytes: number;
}

export const BATCH_BUDGETS = {
  image: {
    noun: 'images',
    maxItems: 50,
    maxBytes: 300 * 1024 * 1024,
    maxOutputBytes: 300 * 1024 * 1024,
    hint: 'Process the images in two batches. Results are held until you download or remove them.',
  },
} as const satisfies Record<string, BatchBudget>;

/** Guards an output page count — PDF work allocates per page, not just per byte. */
export function assertPageBudget(pageCount: number, budget: OperationBudget): void {
  if (budget.maxPages === undefined || pageCount <= budget.maxPages) return;
  throw new ToolError(
    'limit-exceeded',
    `This output would have ${pageCount.toLocaleString()} pages; the limit is ${budget.maxPages.toLocaleString()}.`,
    budget.hint,
  );
}
