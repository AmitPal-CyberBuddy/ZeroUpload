/**
 * Pure page-index helpers. No pdf-lib, no DOM, no worker — safe to import from
 * the React layer (the tool sidebar needs the cap synchronously) and to unit
 * test directly.
 */
import { ToolError } from '../files/errors';

/**
 * Per-page splitting produces N files, each carrying the page's resources, so a
 * document with many image-heavy pages can multiply memory by its page count.
 */
export const MAX_PAGES_FOR_PER_PAGE_SPLIT = 500;

/** Parses "1-3, 5, 8-" into zero-based page indices, validated against the count. */
export function parsePageRanges(input: string, pageCount: number): number[] {
  const cleaned = input.trim();
  if (!cleaned) {
    throw new ToolError('invalid-input', 'Enter at least one page or range.', 'For example: 1-3, 5');
  }

  // "1 - 3" is what people type; normalise spacing around the hyphen before
  // splitting on whitespace, otherwise the hyphen becomes its own token.
  const normalized = cleaned.replace(/\s*-\s*/g, '-');

  const seen = new Set<number>();
  for (const chunk of normalized.split(/[,\s]+/).filter(Boolean)) {
    const match = /^(\d+)?\s*-\s*(\d+)?$/.exec(chunk);
    if (match && (match[1] || match[2])) {
      const start = match[1] ? Number(match[1]) : 1;
      const end = match[2] ? Number(match[2]) : pageCount;
      if (start < 1 || end < 1) {
        throw new ToolError('invalid-input', `"${chunk}" is not a valid page range.`, 'Pages start at 1.');
      }
      if (start > end) {
        throw new ToolError('invalid-input', `"${chunk}" counts backwards.`, 'Use a range like 2-5.');
      }
      for (let i = start; i <= Math.min(end, pageCount); i += 1) seen.add(i - 1);
    } else if (/^\d+$/.test(chunk)) {
      const n = Number(chunk);
      if (n < 1 || n > pageCount) {
        throw new ToolError('invalid-input', `Page ${n} does not exist.`, `This document has ${pageCount} pages.`);
      }
      seen.add(n - 1);
    } else {
      throw new ToolError('invalid-input', `"${chunk}" is not a page number or range.`, 'For example: 1-3, 5');
    }
  }

  if (seen.size === 0) {
    throw new ToolError('invalid-input', 'No pages selected.', 'The ranges you entered are outside this document.');
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Best-effort, non-throwing version of `parsePageRanges`, for live previews.
 * Returns the pages that would be selected, ignoring anything malformed — the
 * real parse still runs (and still throws) when the user starts the operation.
 */
export function summarisePageSelection(input: string, pageCount: number): number[] {
  const seen = new Set<number>();
  const normalized = input.replace(/\s*-\s*/g, '-');
  for (const chunk of normalized.split(/[,\s]+/).filter(Boolean)) {
    const match = /^(\d+)?-(\d+)?$/.exec(chunk);
    if (match && (match[1] || match[2])) {
      const start = match[1] ? Number(match[1]) : 1;
      const end = match[2] ? Number(match[2]) : pageCount;
      for (let i = Math.max(1, start); i <= Math.min(end, pageCount); i += 1) seen.add(i - 1);
    } else if (/^\d+$/.test(chunk)) {
      const page = Number(chunk);
      if (page >= 1 && page <= pageCount) seen.add(page - 1);
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/** Splits [0..pageCount) into contiguous groups of at most `size` pages. */
export function chunkPageIndices(pageCount: number, size: number): number[][] {
  const groups: number[][] = [];
  const step = Math.max(1, Math.floor(size));
  for (let start = 0; start < pageCount; start += step) {
    groups.push(Array.from({ length: Math.min(step, pageCount - start) }, (_, i) => start + i));
  }
  return groups;
}

export function everyPageIndices(pageCount: number): number[][] {
  return Array.from({ length: pageCount }, (_, index) => [index]);
}
