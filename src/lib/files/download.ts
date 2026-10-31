/** Download helpers — everything stays local, we just hand a Blob to the browser. */

export interface DownloadableFile {
  blob: Blob;
  name: string;
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next frame so the navigation has definitely started.
  window.setTimeout(() => URL.revokeObjectURL(url), 4_000);
}

/** A blob that survives until the page is closed — used for "copy to clipboard". */
export async function copyBlobToClipboard(blob: Blob): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('This browser cannot copy images to the clipboard.');
  }
  await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

/** Reads a Blob as UTF-8 text with a hard cap so a binary file cannot freeze the tab. */
export async function readTextSafe(blob: Blob, maxBytes = 25 * 1024 * 1024): Promise<string> {
  if (blob.size > maxBytes) {
    throw new Error('This file is too large to read as text.');
  }
  return blob.text();
}
