/**
 * The words on a tool page.
 *
 * Everything here is checked against what the code actually does: the limits
 * come from `src/lib/files/errors.ts` and `src/lib/files/budget.ts`, the format
 * claims from the tool's own encoder list, and the encryption claims from the
 * measured results in `docs/v2-proofs.md`. If a claim cannot be supported, it
 * does not belong in this file — a page that overpromises is worse than a page
 * that admits a limit, because the limit is what a reader actually needs.
 *
 * Shape per tool:
 *   summary  one paragraph: what happens, in order
 *   does     concrete capabilities, including formats in and out
 *   limits   what it will refuse or cannot do
 *   faq      questions people actually ask, answered in two sentences
 */

export interface ToolContent {
  summary: string;
  does: string[];
  limits: string[];
  faq: Array<{ q: string; a: string }>;
}

const NO_UPLOAD =
  'No. There is no upload endpoint in this app. The file is read with the browser’s own file API and processed in the tab, so it is never sent anywhere — you can watch the network panel and see nothing leave.';

const AFTER_PROCESSING =
  'It stays on your disk exactly as it was; ZeroUpload only ever reads a copy. When you close or reload the page, the copy the browser held is dropped. Nothing is stored, logged or queued.';

export const TOOL_CONTENT: Record<string, ToolContent> = {
  'image-converter': {
    summary:
      'Reads the image with the browser’s own decoder and re-encodes it in the format you choose. Transparency is kept where the target format supports it, and the result reports the exact change in file size.',
    does: [
      'Converts between JPEG, PNG, WebP and AVIF, as far as your browser can encode them — the format list is built from what the current browser actually supports, so it is never a promise the tab cannot keep.',
      'Keeps the alpha channel when converting to PNG, WebP or AVIF, and fills it with the colour you pick when converting to JPEG.',
      'Offers a quality control for the lossy formats, plus an option to ignore the EXIF orientation flag when a camera already baked the rotation into the pixels.',
    ],
    limits: [
      'AVIF encoding is unavailable in some browsers; the option is hidden rather than failing after you press the button.',
      'Converting to a lossy format can make a file larger — the result tells you when it did, instead of claiming a saving.',
      'One image up to 120 MB; a batch of up to 50 images or 300 MB of input.',
    ],
    faq: [
      { q: 'Does converting an image upload it?', a: NO_UPLOAD },
      { q: 'Is there a size limit?', a: 'One image up to 120 MB, or a batch of fifty images totalling 300 MB. The browser has to hold the decoded pixels plus the re-encoded result, and beyond that the tab runs out of memory instead of failing politely.' },
      { q: 'Will the quality drop?', a: 'Only if the target format is lossy, which JPEG, WebP and AVIF are. PNG is lossless but usually larger. The quality dial affects lossy output only.' },
      { q: 'What happens to my file after conversion?', a: AFTER_PROCESSING },
    ],
  },

  favicon: {
    summary:
      'Takes one square image and produces the icon files a site needs — the multi-size ICO, the PNG sizes that browsers and phones ask for, an Apple touch icon, and a web manifest that names them.',
    does: [
      'Generates a complete set from a single square source, downscaling it in the browser with the same code path the other image tools use.',
      'Writes a web manifest and a snippet you can paste into your page, using relative paths so the set also works when the site lives in a subdirectory.',
      'Lets you set the site name and theme colour that the manifest reports to an installed app.',
    ],
    limits: [
      'The source should be square and reasonably large; a 64 px original cannot be upscaled into a sharp 512 px icon.',
      'SVG is not accepted as input — an uploaded SVG can carry script, and the tool refuses that class of file rather than trying to sanitise it.',
      'The generated files are held in the tab until you download them; reloading the page clears them.',
    ],
    faq: [
      { q: 'Is the image uploaded to generate icons?', a: NO_UPLOAD },
      { q: 'Which files does it produce?', a: 'A multi-resolution .ico, the PNG sizes modern browsers and mobile platforms request, an Apple touch icon, and a `site.webmanifest` with a matching HTML snippet.' },
      { q: 'Why is my SVG rejected?', a: 'SVG is a document format that can contain scripts and external references. Rendering one means executing someone else’s code in your page, so the tool only takes raster images.' },
      { q: 'Do I have to download every file?', a: 'No. The snippet plus the manifest covers most sites; the extra PNG sizes matter mainly when someone pins the site or installs it on a phone.' },
    ],
  },

  'image-compressor': {
    summary:
      'Re-encodes the image at the quality you choose, optionally capping its width, and shows the real difference in bytes. If the result would be bigger than the original, it says so.',
    does: [
      'Compresses JPEG, PNG, WebP and AVIF images with presets for the usual jobs (email, web, maximum saving) and a manual quality dial.',
      'Optionally limits the width, which is usually the largest single saving for photos taken on a phone.',
      'Reports the before-and-after size for every file, and keeps the original if the re-encode grew it.',
      'Runs a batch of images one at a time, with per-file progress, a retry for failures, and a ZIP of the results.',
    ],
    limits: [
      'One image up to 120 MB; a batch of up to 50 images or 300 MB of input.',
      'Already-compressed images may barely shrink — a small JPEG that has been through a messenger app twice has very little left to remove.',
      'Lossy compression is irreversible. Keep the original if you may need it again.',
    ],
    faq: [
      { q: 'Are my images uploaded to compress them?', a: NO_UPLOAD },
      { q: 'How much smaller will my file be?', a: 'It depends on the image. A 12 MP phone photo at 80% quality typically loses more than half its bytes; a small, already-optimised JPEG might lose almost nothing. The tool shows the real number rather than an estimate.' },
      { q: 'Is there a batch limit?', a: 'Fifty images per batch, or 300 MB of input, with results held in memory until you download or remove them. Processing is deliberately one file at a time so the tab stays responsive.' },
      { q: 'What happens to the original?', a: AFTER_PROCESSING },
    ],
  },

  resize: {
    summary:
      'Scales an image to exact pixel dimensions or by a percentage, with the aspect ratio locked unless you deliberately unlock it.',
    does: [
      'Sets an exact width and height, or scales proportionally, and shows the resulting dimensions before you commit.',
      'Smooths with the browser’s own scaling, which is the same path a `<canvas>` uses — good for photos and screenshots.',
      'Hands the result to the other image tools, so a resize can be followed straight by a crop or a format change.',
    ],
    limits: [
      'Upscaling cannot add detail that was never in the file; the result is simply larger and softer.',
      'One image up to 120 MB; a batch of up to 50 images or 300 MB of input.',
      'No per-axis filters or sharpening — this is a resize, not a resampler with options.',
    ],
    faq: [
      { q: 'Does resizing upload the picture?', a: NO_UPLOAD },
      { q: 'Can I keep the aspect ratio?', a: 'Yes, and it is locked by default. Unlocking it lets you set width and height independently, which is what you want for a fixed-size banner.' },
      { q: 'Will resizing make the file smaller?', a: 'Usually, because there are fewer pixels to store — but the tool reports the actual byte difference rather than assuming it.' },
      { q: 'What happens to my file afterwards?', a: AFTER_PROCESSING },
    ],
  },

  crop: {
    summary:
      'Crops with a draggable frame on a live preview, or by typing exact coordinates in source pixels, with presets for the ratios people actually need.',
    does: [
      'Crops with a frame on the image or with numeric X, Y, width and height fields that stay in sync.',
      'Offers free, square, 16:9, 4:3, 3:2 and 1:1-style presets, and reports the output size as you drag.',
      'Keeps the crop inside the image — the frame cannot be dragged past an edge and produce a padded result.',
    ],
    limits: [
      'One image up to 120 MB.',
      'The crop is destructive for the output: the removed pixels are not stored anywhere, so keep the original.',
      'No rotation inside the crop view — rotate first, then crop, if the photo is sideways.',
    ],
    faq: [
      { q: 'Is the image uploaded for cropping?', a: NO_UPLOAD },
      { q: 'Can I crop to an exact pixel size?', a: 'Yes. Type the width and height (or the coordinates) instead of dragging; the numeric fields and the frame are the same selection.' },
      { q: 'Does cropping change the picture quality?', a: 'The remaining pixels are copied, not re-compressed, when the format allows it. The output size is the crop you see, not a rescaled version of it.' },
      { q: 'What happens to the cropped-away part?', a: 'It is discarded from the output file only. Your original file on disk is untouched.' },
    ],
  },

  rotate: {
    summary:
      'Turns an image in 90° steps or mirrors it, so a sideways phone photo or a reversed scan comes out the right way round.',
    does: [
      'Rotates in 90° increments — the lossless direction for a raster image, because pixels are moved rather than resampled.',
      'Mirrors horizontally or vertically, which is the fix for a scan or a selfie that came out reversed.',
      'Applies both in any combination and shows the result before you download.',
    ],
    limits: [
      'Arbitrary angles are not offered. A 7° straighten would mean resampling every pixel, and that is a different job.',
      'One image up to 120 MB; a batch of up to 50 images or 300 MB of input.',
      'Rotation applies to the pixels, so the output file is re-encoded in its format.',
    ],
    faq: [
      { q: 'Does rotating upload my photo?', a: NO_UPLOAD },
      { q: 'Does it burn through quality?', a: 'At 90° steps the pixels are moved, not interpolated, so nothing is blurred. The file is re-encoded, which for JPEG means one more generation of compression — the size change is shown.' },
      { q: 'Can it fix the orientation flag instead of the pixels?', a: 'The output is written with the rotated pixels and a neutral orientation, so every viewer shows it the same way. That is more predictable than editing a metadata flag some apps ignore.' },
      { q: 'What happens to my file?', a: AFTER_PROCESSING },
    ],
  },

  'merge-pdf': {
    summary:
      'Copies the pages of several PDFs into one document in the order you arrange them, bookmarking nothing and rewriting nothing.',
    does: [
      'Combines up to 50 PDFs, 250 MB in total and 3,000 pages, in the order shown in the list — reorder before you merge.',
      'Copies pages into the new document rather than re-rendering them, so text stays selectable and fonts and images survive intact.',
      'Reports progress per document, and names the file that caused a failure instead of failing the whole merge silently.',
    ],
    limits: [
      'Encrypted PDFs are refused: a protected document cannot be parsed without its password, so unlock it first.',
      'Pages are copied, not flattened — forms and annotations keep their existing behaviour, but this is not an editor.',
      'A single PDF is capped at 200 MB; the whole merge at 250 MB and 3,000 pages, because the browser holds every document at once.',
    ],
    faq: [
      { q: 'Are the PDFs uploaded to be merged?', a: NO_UPLOAD },
      { q: 'Will the text still be selectable?', a: 'Yes. Pages are copied into the new file rather than rendered as images, so search, copy and screen readers keep working.' },
      { q: 'What if one file is password-protected?', a: 'The merge stops and names it. Remove the password with the unlock tool first, then merge — a protected file cannot be read without its key.' },
      { q: 'What happens to the originals?', a: AFTER_PROCESSING },
    ],
  },

  'split-pdf': {
    summary:
      'Extracts the pages you name, splits the document into equal parts, or makes one file per page — and hands you a PDF or a ZIP when there are several results.',
    does: [
      'Selects pages by range syntax (`1-3, 7, 10-`) and shows how many pages the selection contains before splitting.',
      'Splits every page into its own file, or splits every N pages into equal documents.',
      'Delivers one PDF when the result is a single file, and a ZIP when it is several, so you are not left with a dozen downloads.',
    ],
    limits: [
      'One document up to 200 MB.',
      '“One file per page” is disabled above 500 pages, where the number of output documents would exhaust memory — use “every N pages” instead.',
      'Extracting pages does not remove them from the original; the original is a separate file that stays as it was.',
    ],
    faq: [
      { q: 'Is the document uploaded to split it?', a: NO_UPLOAD },
      { q: 'How do I delete pages?', a: 'Select the pages you want to keep and extract them into a new document. The original is never modified, which is why the safe direction is “keep these” rather than “delete those”.' },
      { q: 'Why do I get a ZIP?', a: 'When the result is more than one file, individual downloads would be tedious and the browser may block them. A single ZIP is one download, built in the tab.' },
      { q: 'What happens to the PDF afterwards?', a: AFTER_PROCESSING },
    ],
  },

  'rotate-pdf': {
    summary:
      'Applies a 90°, 180° or 270° rotation to the pages of a PDF, which is the fix for a scan that arrived sideways.',
    does: [
      'Rotates every page by the same amount, or only the pages you list.',
      'Writes the rotation into the page definitions rather than re-rendering the content, so text and images are untouched.',
      'Reports progress and produces a new file, leaving the original as it was.',
    ],
    limits: [
      'Rotation is in 90° steps. Arbitrary angles would mean re-rendering every page and losing the text layer.',
      'One document up to 200 MB.',
      'It rotates the page box; it does not crop the new white margin that appears when a landscape scan is turned upright.',
    ],
    faq: [
      { q: 'Does rotating a PDF upload it?', a: NO_UPLOAD },
      { q: 'Does the text stay selectable?', a: 'Yes. Only the page rotation is rewritten; the content stream is copied as-is.' },
      { q: 'Can I rotate a single page?', a: 'Yes. Type the pages into the range field — 1-3, 7, 10- — and only those pages turn. Leave it empty to turn every page.' },
      { q: 'What happens to my file?', a: AFTER_PROCESSING },
    ],
  },

  'images-to-pdf': {
    summary:
      'Places images into a new PDF, one page per image or fitted to A4 with margins, in the order you arrange them.',
    does: [
      'Takes up to 200 images, 150 MB in total, and produces a single PDF.',
      'Offers a page that matches each image at 72 DPI, or A4 pages with the image centred inside margins — portrait, or matched to each image’s own orientation.',
      'Keeps the order shown in the list, and reports per-image failures by name instead of dropping them quietly.',
    ],
    limits: [
      'Images are embedded, not converted to text — a photo of a receipt becomes a picture in a PDF, not a searchable document.',
      'The combined input is capped at 150 MB and 200 images.',
      'Encrypted or damaged images are reported and skipped; they are not repaired.',
    ],
    faq: [
      { q: 'Are my photos uploaded to build the PDF?', a: NO_UPLOAD },
      { q: 'Can I set the page size?', a: 'You can choose a page that fits each image, A4 portrait, or A4 with each page taking its image’s orientation so landscape photos do not sit in a band of empty space. All three are generated locally.' },
      { q: 'Will the scanned text be searchable?', a: 'No. Producing searchable text from a scan needs OCR, which this tool does not run, and pretending otherwise would be misleading.' },
      { q: 'What happens to the images afterwards?', a: AFTER_PROCESSING },
    ],
  },

  'protect-pdf': {
    summary:
      'Encrypts the document with AES-256 and either asks for a password before it opens, or leaves it open to anyone with restrictions recorded. A second password controls the restrictions themselves.',
    does: [
      '“Require a password to open” sets the PDF open password: without it the document cannot be decrypted, so no page can be read.',
      '“Anyone can open” leaves the open password empty — the file still carries restrictions, but a reader shows it without asking for anything.',
      'Editing, printing, copying and commenting are each recorded separately, so a document can be read-only without being unreadable.',
      'The permissions password is the PDF owner password: it is what lifts or changes the restrictions later, and it can be different from the open password.',
    ],
    limits: [
      'Permissions are intent, not enforcement. Readers that ignore them — including several built-in browser viewers — will happily print or copy a restricted file. The open password is the only part that stops someone reading it.',
      'The permissions password can also open the document, because the PDF standard gives the owner password full access. It is not a separate read-protection layer.',
      'There is no recovery for either password: nothing is stored anywhere, so a forgotten open password means the document is gone.',
    ],
    faq: [
      { q: 'Does it upload my PDF to encrypt it?', a: NO_UPLOAD },
      { q: 'What is the difference between the open password and the permissions password?', a: 'The open password is required to decrypt the file at all. The permissions password protects the restriction flags, and is what someone needs in order to change or lift them. They can be the same password, which is the default when you leave the second field blank.' },
      { q: 'Can I restrict editing without requiring a password to open?', a: 'Yes — choose “Anyone can open” and turn on the restrictions. The file is still AES-256 encrypted, but with an empty open password, so readers show it immediately. Compliant readers then apply the restrictions; readers that ignore PDF permissions will not.' },
      { q: 'Can ZeroUpload recover a forgotten password?', a: 'No, and that is the point. Neither password leaves the tab or is stored anywhere, so there is nothing to reset. Keep them somewhere safe before you close the page.' },
      { q: 'Does restricting copying stop someone extracting the text?', a: 'Only in readers that enforce PDF permissions. Any tool that ignores the flags can read the content, so treat the restrictions as a clear signal of intent rather than as protection of the text itself.' },
    ],
  },

  'unlock-pdf': {
    summary:
      'Removes the password from a PDF you can already open, producing a copy that no longer asks for one.',
    does: [
      'Reads documents encrypted with AES-256, AES-128 and the older RC4 schemes, including files that carry only restriction flags.',
      'Writes a new file with no encryption dictionary and no key material, so it opens anywhere without a prompt.',
      'Keeps the page content as it was — text stays selectable and the layout is untouched.',
    ],
    limits: [
      'This is not a cracking tool. Without the password it cannot open the document, and it does not attempt to guess anything.',
      'One document up to 200 MB.',
      'Removing protection removes it for everyone who has the output file; there is no way to keep a restriction without the password.',
    ],
    faq: [
      { q: 'Does unlocking upload my PDF?', a: NO_UPLOAD },
      { q: 'What if I do not know the password?', a: 'Then this tool cannot help, and no honest local tool can. It decrypts with the password you supply; it does not brute-force one.' },
      { q: 'Is the output really unprotected?', a: 'Yes. The output contains no encryption dictionary, so there is no password to remove and nothing left to leak — which also means you should handle the new file as unprotected.' },
      { q: 'What happens to my protected original?', a: AFTER_PROCESSING },
    ],
  },

  'create-zip': {
    summary:
      'Bundles files into a ZIP archive, optionally with an AES-256 password, and tells you what that choice costs in compatibility before you create it.',
    does: [
      'Adds up to 2,000 files or 512 MB for a plain archive, and writes the archive in a worker so the page stays responsive.',
      'Optionally encrypts with AES-256 (WinZip AE-2), with a cumulative limit of 64 MB and 500 files because encryption needs roughly four times the working memory.',
      'Offers the older ZipCrypto scheme only as an explicit choice, labelled for what it is: widely readable and breakable.',
      'Offers “store” as well as DEFLATE: already-compressed files like JPEG, MP4 and other archives save nothing by being compressed, so they can be written as they are.',
    ],
    limits: [
      'AES-256 archives do not open in Windows File Explorer or macOS Archive Utility. They need 7-Zip, WinRAR, Keka or PeaZip — the warning is shown before the archive is created, not after.',
      'Plain ZIPs are capped at 512 MB and 2,000 files; encrypted ones at 64 MB and 500 files.',
      'No archive repair and no incremental update — this writes new archives, it does not edit existing ones.',
    ],
    faq: [
      { q: 'Are my files uploaded to create the ZIP?', a: NO_UPLOAD },
      { q: 'Will Windows open a password-protected archive?', a: 'Not directly. Explorer and the macOS Archive Utility cannot read AES ZIPs; 7-Zip, WinRAR, Keka and PeaZip can. If the recipient only has Explorer, create a plain archive and send the password some other way — or accept ZipCrypto knowing it is weak.' },
      { q: 'Why is the encrypted limit so much smaller?', a: 'Measured on this code: AES-256 adds about 3.8× the input size in working memory. 64 MB keeps the peak inside a normal tab; 512 MB of encrypted input would ask a phone for gigabytes.' },
      { q: 'What happens to my files afterwards?', a: AFTER_PROCESSING },
    ],
  },

  'extract-zip': {
    summary:
      'Opens an archive and lists what is inside — names, sizes and compression — before you extract anything.',
    does: [
      'Reads plain ZIPs, AES-256 archives and the older ZipCrypto format, asking for the password only when the archive actually needs one.',
      'Lists every entry with its compressed and expanded size, so you can see what the archive really contains before unpacking it.',
      'Applies its limits from the central directory first: 5,000 entries, 512 MB expanded in total, 256 MB for any single entry.',
    ],
    limits: [
      'Those three numbers are a zip-bomb guard. An archive that expands past them is refused before a byte is inflated.',
      'Entry names are sanitised; paths that try to escape the extraction folder are not written.',
      'It extracts to memory and gives you the files — it does not write into a folder on disk by itself.',
    ],
    faq: [
      { q: 'Is the archive uploaded to be opened?', a: NO_UPLOAD },
      { q: 'Can it open a password-protected ZIP?', a: 'Yes, AES-256 and ZipCrypto both, once you supply the password. The check happens in the tab; the password is not stored.' },
      { q: 'Why was my archive refused?', a: 'Because its declared contents exceeded a limit — most often more than 512 MB expanded from a small file, which is the shape of a zip bomb. The limits are there so a hostile archive cannot exhaust the browser.' },
      { q: 'What happens to the extracted files?', a: 'They stay in the tab until you download them. Nothing is written to disk, uploaded or kept after you close the page.' },
    ],
  },

  'unlock-office': {
    summary:
      'Removes the password from a protected Word, Excel or PowerPoint file, producing the original document back in its unencrypted form.',
    does: [
      'Decrypts .docx, .xlsx and .pptx documents protected with the modern Office encryption scheme (AES-256 with SHA-512 key derivation).',
      'Verifies the key before writing anything: a wrong password fails loudly instead of producing a corrupt file.',
      'Takes about half a second per document even for small files, because the key derivation is deliberately slow by design.',
    ],
    limits: [
      'The password is required. There is no guessing, no dictionary and no recovery.',
      'One document up to 100 MB, because decryption holds the container and the package at the same time.',
      'Legacy binary formats (.doc, .xls, .ppt) are not supported — only the XML-based formats.',
    ],
    faq: [
      { q: 'Is the document uploaded to remove the password?', a: NO_UPLOAD },
      { q: 'Does it work on old .doc files?', a: 'No. Only the modern .docx, .xlsx and .pptx containers. The older binary formats use a different encryption scheme that this tool does not implement.' },
      { q: 'Why does it take half a second?', a: 'Because Office key derivation is intentionally expensive — around 100,000 hash iterations — so each guess is slow. That is what makes the password hard to brute-force, and it is why the delay is expected rather than a bug.' },
      { q: 'What happens to my file afterwards?', a: 'The original encrypted file is untouched. The decrypted copy exists only in the tab until you download it, and it is unprotected from that point on.' },
    ],
  },

  'encrypt-office': {
    summary:
      'Adds a password to a Word, Excel or PowerPoint file, using the same encryption scheme Office itself uses.',
    does: [
      'Encrypts .docx, .xlsx and .pptx with AES-256 and SHA-512 key derivation, matching the modern Office format.',
      'Keeps the document’s internal structure intact, so it opens in Office as a normal password-protected file.',
      'Runs the key derivation and encryption in the tab, with progress reported while it works.',
    ],
    limits: [
      'This tool is behind an interoperability flag and is off by default: the round trip is verified against a reference implementation, but not yet against real Word, Excel and PowerPoint installations.',
      'One document up to 100 MB.',
      'No recovery. A forgotten password means a lost document.',
    ],
    faq: [
      { q: 'Is this tool available right now?', a: 'No — it is gated behind a build flag and hidden from the catalogue by default, because it has not been verified against the real Office applications yet.' },
      { q: 'Would my file be uploaded?', a: NO_UPLOAD },
      { q: 'What is missing before it ships?', a: 'Round trips through a genuine copy of Word, Excel and PowerPoint. Everything else — the format, the key derivation, the integrity check — has been verified.' },
    ],
  },

  'file-inspector': {
    summary:
      'Reads the opening bytes of a file to identify its real type, reports what it can tell you about the contents, and hashes the file so it can be compared.',
    does: [
      'Identifies the format from magic bytes rather than the extension, and flags the file when the two disagree.',
      'Reports what applies to that format: image dimensions, PDF page count and metadata, archive entry count, and the text encoding it found.',
      'Computes a SHA-256 digest of the contents, the same value `sha256sum` produces, so two files can be checked for identity.',
    ],
    limits: [
      'Hashing needs the whole file in memory; it is offered up to 512 MB, above which the tool declines rather than risking the tab.',
      'It reports what is declared, not what is safe — a file that declares itself a JPEG is described as a JPEG, not certified as harmless.',
      'No malware scanning. This is a description of the bytes, not a verdict on them.',
    ],
    faq: [
      { q: 'Is the file uploaded to inspect it?', a: NO_UPLOAD },
      { q: 'Can it tell me if a file is dangerous?', a: 'No. It can tell you the file is not what its extension claims, which is a strong hint, but it does not scan for malware and it never executes anything. Treat it as evidence, not as a guarantee.' },
      { q: 'Why does the hash take longer than the rest?', a: 'Because a digest covers every byte, while the type check only reads the header. Hashing is offered up to 512 MB for that reason — the whole file has to be read.' },
      { q: 'What happens to my file after inspecting it?', a: AFTER_PROCESSING },
    ],
  },

  'json-formatter': {
    summary:
      'Parses JSON and re-serialises it with the indentation you choose, compresses it to a single line, or points at the exact line and column where it stopped being valid.',
    does: [
      'Formats with 2 or 4 spaces or tabs, and optionally sorts object keys so two payloads can be compared by eye.',
      'Minifies to the smallest equivalent text — useful before shipping a configuration payload.',
      'Reports a syntax error with its position and the offending line, instead of a bare "Unexpected token".',
      'Takes pasted text, up to 25 MB.',
    ],
    limits: [
      'Text only — this tool takes a paste, not a file drop. The file inspector and the PDF tools are where files go.',
      'Only JSON. Comments and trailing commas are rejected, because they are not JSON — use JSON5 tooling if that is what you have.',
      'Formatting a 25 MB document will be slow, because the tab has to parse and re-serialise every node.',
      'There is no JSONPath, no diff and no schema validation.',
    ],
    faq: [
      { q: 'Is my JSON uploaded to format it?', a: NO_UPLOAD },
      { q: 'Does minifying change the data?', a: 'No. Whitespace outside strings carries no meaning in JSON, so the parsed value is identical. Key order is preserved unless you ask for sorting.' },
      { q: 'Can it validate against a schema?', a: 'No, it validates syntax only — that the text is well-formed JSON. Schema validation is a different job and is not done here.' },
      { q: 'What happens to my data afterwards?', a: 'Nothing is stored. The text exists in the tab, in memory, and disappears when you close or reload the page.' },
    ],
  },

  base64: {
    summary:
      'Encodes text or a file to Base64 and decodes it back, with UTF-8 handled correctly and a URL-safe variant when you need it.',
    does: [
      'Encodes and decodes text in UTF-8 — accented characters and emoji survive the round trip.',
      'Offers the URL-safe alphabet (`-` and `_` instead of `+` and `/`) with padding optional, which is what JSON Web Tokens use.',
      'Encodes file contents to a Base64 string, and decodes Base64 back into a downloadable file.',
    ],
    limits: [
      'Text is capped at 25 MB; a file encoded to Base64 is capped at 10 MB, because the output is a third larger again.',
      'Base64 is an encoding, not encryption. Anything encoded this way is readable by anyone.',
      'Invalid input is reported with its position rather than silently skipped.',
    ],
    faq: [
      { q: 'Is my data uploaded to encode it?', a: NO_UPLOAD },
      { q: 'Is Base64 secure?', a: 'No, and it is important not to treat it as protection. It is a transport encoding: anyone can decode it in one step. Use encryption if the content is sensitive.' },
      { q: 'Why does my decoded text look wrong?', a: 'Usually a character-set mismatch. The decoder assumes UTF-8; binary data decoded as text will produce replacement characters, which is why file mode exists.' },
      { q: 'What happens to the text afterwards?', a: 'It stays in the tab and is never stored or sent. Closing the page discards it.' },
    ],
  },

  'url-encoder': {
    summary:
      'Percent-encodes a URL, a path segment or a query value, and decodes one back — telling you when the input was malformed rather than quietly mangling it.',
    does: [
      'Encodes for the right context: a whole URL keeps its separators, a component escapes them, which is the difference between `encodeURI` and `encodeURIComponent`.',
      'Decodes `%20`, `+` and multi-byte sequences back to readable text.',
      'Reports an incomplete or invalid escape sequence instead of throwing a generic error.',
    ],
    limits: [
      'It does not parse or normalise a URL beyond encoding it — no query-string editing, no host validation.',
      'Text is capped at 25 MB.',
      'Double-encoded input decodes one layer at a time; the tool does not guess how many were applied.',
    ],
    faq: [
      { q: 'Is my URL uploaded to encode it?', a: NO_UPLOAD },
      { q: 'Component or full URL — which do I need?', a: 'Full URL when the whole address should stay intact and only illegal characters are escaped; component when the value will be placed inside a query parameter, where `&`, `=` and `/` must themselves be escaped.' },
      { q: 'Why does `+` sometimes become a space?', a: 'Because form encoding treats `+` as a space, while path encoding does not. The decoder tells you which interpretation it used rather than guessing silently.' },
      { q: 'What happens to the input afterwards?', a: 'It stays in the tab. Nothing is logged — which matters when the URL carries a token.' },
    ],
  },

  'hash-generator': {
    summary:
      'Computes SHA-256, SHA-512 or SHA-1 digests of text with the browser’s Web Crypto API, and shows the result as hex.',
    does: [
      'Hashes text with SHA-256, SHA-512 or SHA-1, updating as you type.',
      'Uses the platform implementation of the algorithms, not a hand-rolled one.',
      'Can hash a file with the same algorithms through the file inspector, where the input is bytes rather than text.',
    ],
    limits: [
      'SHA-1 is offered for compatibility with old checksums and should not be used for anything new.',
      'A hash is not a password store. These algorithms are fast by design, which is exactly what makes them unsuitable for passwords.',
      'Text is capped at 25 MB.',
    ],
    faq: [
      { q: 'Is my text uploaded to hash it?', a: NO_UPLOAD },
      { q: 'Can I use these hashes for passwords?', a: 'No. SHA-256 is fast, and fast is the wrong property for password storage — an attacker can try billions of guesses per second. Use a password hashing function designed for it, such as Argon2 or bcrypt, server-side.' },
      { q: 'Which algorithm should I choose?', a: 'SHA-256 for almost everything. SHA-512 when you want a longer digest, SHA-1 only to match a checksum someone else already computed.' },
      { q: 'Can it hash a file?', a: 'Yes — open the file inspector, which hashes the contents up to 512 MB and also reports the file’s real type.' },
    ],
  },
};
