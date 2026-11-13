import { getToolAny, getTool, type ToolDefinition } from '../registry/tools';

/**
 * The definition a tool component renders its own shell from.
 *
 * Every tool component needs its registry entry to draw the heading, breadcrumb
 * and metadata. The obvious lookup is `getTool('slug')!`, which is a promise to
 * the type system that the slug exists — and the project has already broken that
 * promise once: `ProtectOfficeTool` read `getTool('encrypt-office')!` for a tool
 * the registry *hides* behind a flag, so the day anything mounted it outside the
 * router it crashed on `undefined.slug` instead of rendering.
 *
 * Two things are fixed here rather than in twenty-one call sites:
 *
 *  - `getToolAny` is used, so a flagged tool can still describe itself. Routing —
 *    not the component — is what decides whether anyone reaches it.
 *  - A missing entry throws a readable error naming the slug. A registry this
 *    small is either complete or it is a build bug, and a build bug should say
 *    which entry is missing rather than produce a blank page.
 */
export function toolDefinition(slug: string): ToolDefinition {
  const found = getToolAny(slug);
  if (!found) {
    throw new Error(
      `No tool is registered as "${slug}". Add it to src/registry/tools.ts — a component without a definition has no route, no title and no metadata.`,
    );
  }
  return found;
}

/**
 * The routing answer: the definition only when the tool is actually reachable.
 *
 * `undefined` for a flag-hidden tool is correct here, and callers are expected to
 * handle it (the router renders a 404). Use `toolDefinition` inside a component
 * that is already mounted, and this one anywhere that decides *whether* to mount.
 */
export function routedToolDefinition(slug: string): ToolDefinition | undefined {
  return getTool(slug);
}
