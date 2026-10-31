import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Lazy tool registry. Every tool is its own chunk; heavy dependencies (pdf-lib,
 * fflate) are imported *inside* the tool module so they are only fetched when
 * that tool is opened.
 */
export const TOOL_COMPONENTS: Record<string, LazyExoticComponent<ComponentType>> = {
  'image-converter': lazy(() => import('../tools/convert/ImageConverterTool')),
  favicon: lazy(() => import('../tools/convert/FaviconTool')),
  'image-compressor': lazy(() => import('../tools/compress/ImageCompressorTool')),
  resize: lazy(() => import('../tools/transform/ResizeTool')),
  crop: lazy(() => import('../tools/transform/CropTool')),
  rotate: lazy(() => import('../tools/transform/RotateTool')),
  'merge-pdf': lazy(() => import('../tools/pdf/MergePdfTool')),
  'split-pdf': lazy(() => import('../tools/pdf/SplitPdfTool')),
  'rotate-pdf': lazy(() => import('../tools/pdf/RotatePdfTool')),
  'images-to-pdf': lazy(() => import('../tools/pdf/ImagesToPdfTool')),
  'protect-pdf': lazy(() => import('../tools/pdf/ProtectPdfTool')),
  'unlock-pdf': lazy(() => import('../tools/pdf/UnlockPdfTool')),
  'create-zip': lazy(() => import('../tools/archive/CreateZipTool')),
  'extract-zip': lazy(() => import('../tools/archive/ExtractZipTool')),
  'unlock-office': lazy(() => import('../tools/archive/UnlockOfficeTool')),
  // Compiled in, but the registry hides the route unless
  // VITE_ENABLE_OFFICE_ENCRYPTION is set — see src/lib/office/features.ts.
  'encrypt-office': lazy(() => import('../tools/archive/ProtectOfficeTool')),
  'file-inspector': lazy(() => import('../tools/inspect/FileInspectorTool')),
  'json-formatter': lazy(() => import('../tools/dev/JsonFormatterTool')),
  base64: lazy(() => import('../tools/dev/Base64Tool')),
  'url-encoder': lazy(() => import('../tools/dev/UrlEncoderTool')),
  'hash-generator': lazy(() => import('../tools/dev/HashGeneratorTool')),
};
