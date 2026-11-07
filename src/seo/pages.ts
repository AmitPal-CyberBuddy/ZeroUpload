/**
 * Per-page search metadata.
 *
 * One source of truth for the `<title>`, meta description, canonical, Open
 * Graph and social tags of every indexable page. The prerenderer reads it at
 * build time; the app reads it again on client-side navigation so a visitor
 * moving between tools always has a title and a canonical that match the URL.
 *
 * Rules for the copy in here:
 *
 *  - a title names the capability the way a person searches for it, then a real
 *    differentiator — never a keyword list;
 *  - a description makes one concrete claim that is visible on the page;
 *  - nothing is claimed that the tool does not do, and no tool is described as
 *    uploading a file, requiring an account, or guaranteeing a result.
 */

export interface PageMeta {
  /** Full document title, including the brand suffix where it fits. */
  title: string;
  /** 120–165 characters. Shown in results and social previews. */
  description: string;
  /** Set on pages that must stay out of the index. */
  noindex?: boolean;
}

const BRAND = 'ZeroUpload';

/** Standalone pages. Keys are canonical paths. */
export const PAGE_META: Record<string, PageMeta> = {
  '/': {
    title: `${BRAND} — Every File Tool, Nothing Uploaded`,
    description:
      'Convert, compress, crop, merge, split, protect and inspect files in your browser. No upload, no account and no queue — the work happens on your device.',
  },
  '/tools/': {
    title: `All Tools — Convert, Compress, Protect · ${BRAND}`,
    description:
      'The full ZeroUpload catalogue: image, PDF, archive, inspection and developer tools. Every one of them runs inside your browser.',
  },
  '/how-it-works/': {
    title: `How ${BRAND} Works — No Uploads · ${BRAND}`,
    description:
      'What runs in your browser, what the limits are, and why no file is ever sent to a server. The architecture explained in plain terms.',
  },
};

/** Category landing pages, keyed by category id. */
export const CATEGORY_META: Record<string, PageMeta> = {
  image: {
    title: `Image Tools — Compress, Convert, Resize · ${BRAND}`,
    description:
      'Compress, convert, resize, crop, rotate and turn images into favicons in your browser. JPEG, PNG, WebP and AVIF, with nothing uploaded.',
  },
  pdf: {
    title: `PDF Tools — Merge, Split, Protect, Unlock · ${BRAND}`,
    description:
      'Merge, split, rotate and password-protect PDFs, or turn photos into a document. Pages are copied, text stays selectable, nothing is uploaded.',
  },
  archive: {
    title: `ZIP & Office Tools — Create, Extract, Unlock · ${BRAND}`,
    description:
      'Build ZIP archives with optional AES-256 passwords, inspect an archive before extracting it, and remove a password from Word, Excel or PowerPoint files.',
  },
  inspect: {
    title: `File Inspector — Real Type, Metadata, SHA-256 · ${BRAND}`,
    description:
      'Identify what a file really is from its first bytes, see the metadata it carries, and compute a SHA-256 digest. A wrong extension gets flagged.',
  },
  developer: {
    title: `Developer Tools — JSON, Base64, URL, Hashes · ${BRAND}`,
    description:
      'Format, minify and validate JSON, encode Base64 and URLs, and compute SHA-256 digests without sending production data to someone else’s server.',
  },
};

/**
 * Tool page metadata, keyed by registry slug.
 *
 * The `name` on each entry is the visible `<h1>` from the registry; these titles
 * keep it but add the phrase people actually search for. Descriptions repeat
 * only facts the tool page itself states.
 */
export const TOOL_META: Record<string, PageMeta> = {
  'image-converter': {
    title: `Image Converter — JPEG, PNG, WebP, AVIF · ${BRAND}`,
    description:
      'Convert an image between JPEG, PNG, WebP and AVIF in your browser. Transparency kept where the format allows it, quality control, exact size delta.',
  },
  favicon: {
    title: `Favicon Generator — Every Icon Size · ${BRAND}`,
    description:
      'Turn one square image into a complete favicon set: ICO, PNG sizes, an Apple touch icon and a web manifest, plus a snippet you can paste.',
  },
  'image-compressor': {
    title: `Image Compressor — Shrink Images Locally · ${BRAND}`,
    description:
      'Reduce the size of JPEG, PNG, WebP and AVIF images with a quality dial and optional downscaling. The real before-and-after size is shown before you save.',
  },
  resize: {
    title: `Image Resizer — Exact Pixels or Scale · ${BRAND}`,
    description:
      'Resize an image to exact pixel dimensions or scale it proportionally, with the aspect ratio locked until you unlock it. All of it happens in the browser.',
  },
  crop: {
    title: `Image Cropper — Precise Framing · ${BRAND}`,
    description:
      'Crop an image with a draggable frame, aspect presets or a ratio of your own, and see the output dimensions before you download. Nothing is uploaded.',
  },
  rotate: {
    title: `Rotate & Flip an Image · ${BRAND}`,
    description:
      'Rotate an image in 90° steps or mirror it horizontally or vertically, then download the result. The whole edit happens inside your browser.',
  },
  'merge-pdf': {
    title: `Merge PDF — Combine PDFs Locally · ${BRAND}`,
    description:
      'Combine several PDFs into one document in the order you choose. Pages are copied rather than re-rendered, so text stays selectable. No upload.',
  },
  'split-pdf': {
    title: `Split PDF & Extract Pages · ${BRAND}`,
    description:
      'Extract the pages you need, split a PDF into one file per page, or drop pages you do not want. Results arrive as a PDF or a ZIP, built locally.',
  },
  'rotate-pdf': {
    title: `Rotate PDF Pages · ${BRAND}`,
    description:
      'Turn the pages of a PDF by 90, 180 or 270 degrees to fix a sideways scan. The file is rewritten in your browser and never leaves the device.',
  },
  'images-to-pdf': {
    title: `Images to PDF — JPG & PNG · ${BRAND}`,
    description:
      'Assemble JPG, PNG and other images into one PDF — a page per image or fitted to A4 — in the order you arrange. Assembly happens in the browser.',
  },
  'protect-pdf': {
    title: `PDF Password Protector — AES-256 · ${BRAND}`,
    description:
      'Require a password to open a PDF, or leave it open to anyone and restrict editing, printing and copying. AES-256, encrypted in your browser.',
  },
  'unlock-pdf': {
    title: `Remove a PDF Password · ${BRAND}`,
    description:
      'Remove the password from a PDF you can already open, so it stops asking for one. This unlocks documents you have the password for; it does not crack them.',
  },
  'create-zip': {
    title: `Create ZIP — Compress & Encrypt · ${BRAND}`,
    description:
      'Bundle files into a ZIP, with optional AES-256 password protection. Encrypted archives open in 7-Zip, WinRAR, Keka and PeaZip, but not in File Explorer.',
  },
  'extract-zip': {
    title: `Extract ZIP — Unzip Locally · ${BRAND}`,
    description:
      'Open a ZIP and see exactly what is inside before you save anything. Reads AES-256 and ZipCrypto archives, with limits that guard against zip bombs.',
  },
  'unlock-office': {
    title: `Unlock a Word, Excel or PowerPoint File · ${BRAND}`,
    description:
      'Remove the password from a protected DOCX, XLSX or PPTX file you can open. Decryption happens in your browser; the document is never uploaded.',
  },
  'encrypt-office': {
    title: `Protect a Word, Excel or PowerPoint File · ${BRAND}`,
    description:
      'Add a password to a DOCX, XLSX or PPTX file with the same AES-256 scheme Office uses. Available behind an interoperability flag until it is verified in Office itself.',
  },
  'file-inspector': {
    title: `File Inspector — Type, Metadata, SHA-256 · ${BRAND}`,
    description:
      'See what a file really is from its first bytes, read its dimensions and metadata, and compute a SHA-256 digest. A mismatched extension gets flagged.',
  },
  'json-formatter': {
    title: `JSON Formatter, Validator & Minifier · ${BRAND}`,
    description:
      'Format JSON with the indent you prefer, minify it, or find the exact line and column of a syntax error. Paste it in; nothing is uploaded.',
  },
  base64: {
    title: `Base64 Encoder & Decoder · ${BRAND}`,
    description:
      'Encode text or a file to Base64 and decode it back, in UTF-8 or URL-safe form. Large inputs are handled without freezing the tab.',
  },
  'url-encoder': {
    title: `URL Encoder & Decoder · ${BRAND}`,
    description:
      'Percent-encode a query component or a whole URL and decode it back. Malformed escape sequences are reported rather than silently dropped.',
  },
  'hash-generator': {
    title: `SHA-256, SHA-512 & SHA-1 Hash Generator · ${BRAND}`,
    description:
      'Compute SHA-256, SHA-512 or SHA-1 digests of text with the browser’s Web Crypto API. Useful for checksums; not a way to store passwords.',
  },
};

/** Copy for the two redirect-only pages. Never indexed. */
export const REDIRECT_META: Record<string, { to: string }> = {
  '/architecture/': { to: '/how-it-works/' },
};
