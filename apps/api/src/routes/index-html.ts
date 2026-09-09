// The app shell a deployment's branding reaches before any script runs (spec 06 §6).
//
// `index.html` paints a ground colour and carries a placeholder title so that a member who
// works in the dark never sees a white flash while the bundle loads. Both are the web app's
// own defaults, and the running application replaces them once it has read its settings. A
// deployment that fixes the title or a scheme's background wants them in that first paint too,
// which is what this does: the shell is read once at startup and served as a transformed
// string, so nothing is rewritten per request.
//
// Only the three fields the shell can honour before the bundle evaluates are used. Everything
// else in the branding document is applied by the application itself.

import type { DeploymentSettingsOverrides } from '@golinks/shared/settings'

/** What a deployment fixes that the shell itself can show. */
export interface ShellBranding {
  title: string | undefined
  lightBackground: string | undefined
  darkBackground: string | undefined
}

/** Colors reach here through the settings schema; this is the last guard before the markup. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i

function colorOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : undefined
}

/** The shell-visible part of an overrides document. */
export function shellBrandingOf(overrides: DeploymentSettingsOverrides): ShellBranding {
  const branding = overrides.branding
  return {
    title:
      typeof branding?.title === 'string' && branding.title.length > 0 ? branding.title : undefined,
    lightBackground: colorOrUndefined(branding?.light?.backgroundColor),
    darkBackground: colorOrUndefined(branding?.dark?.backgroundColor),
  }
}

/** True when the deployment fixes nothing the shell can paint. */
export function isEmptyShellBranding(branding: ShellBranding): boolean {
  return (
    branding.title === undefined &&
    branding.lightBackground === undefined &&
    branding.darkBackground === undefined
  )
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
}

function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (character) => HTML_ESCAPES[character] ?? character)
}

/**
 * The rules the deployment's colours produce, in the shape the shell already uses: a light
 * value on `:root`, the two `data-` attributes the application sets once it is running, and
 * the dark preference media rule.
 *
 * A light value alone is scoped to the light preference rather than written on a bare `:root`.
 * A bare rule appended after the shell's own would win over the shell's dark media rule too,
 * and repaint a dark-preference browser in the light ground, which is the flash this exists to
 * prevent.
 */
function backgroundRules(branding: ShellBranding): string[] {
  const rules: string[] = []
  const { lightBackground: light, darkBackground: dark } = branding

  if (light !== undefined) {
    rules.push(
      dark === undefined
        ? `@media (prefers-color-scheme: light) { :root { background-color: ${light}; } }`
        : `:root { background-color: ${light}; }`,
    )
    rules.push(`:root[data-light] { background-color: ${light}; }`)
  }
  if (dark !== undefined) {
    rules.push(`:root[data-dark] { background-color: ${dark}; }`)
    rules.push(`@media (prefers-color-scheme: dark) { :root { background-color: ${dark}; } }`)
  }
  return rules
}

const TITLE_ELEMENT = /<title>[\s\S]*?<\/title>/i
const HEAD_END = /<\/head>/i

/**
 * The shell with the deployment's title and ground colours in it. Returns the document
 * unchanged when the deployment fixes neither, so a deployment that overrides nothing is
 * served exactly the bytes the web build produced.
 */
export function transformIndexHtml(html: string, overrides: DeploymentSettingsOverrides): string {
  const branding = shellBrandingOf(overrides)
  if (isEmptyShellBranding(branding)) return html

  let transformed = html
  if (branding.title !== undefined) {
    transformed = transformed.replace(TITLE_ELEMENT, `<title>${escapeText(branding.title)}</title>`)
  }

  const rules = backgroundRules(branding)
  if (rules.length > 0 && HEAD_END.test(transformed)) {
    const style = [
      '    <!-- The ground this deployment fixes (spec 06 section 6). -->',
      '    <style>',
      ...rules.map((rule) => `      ${rule}`),
      '    </style>',
      '  ',
    ].join('\n')
    transformed = transformed.replace(HEAD_END, `${style}</head>`)
  }

  return transformed
}
