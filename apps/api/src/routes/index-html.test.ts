import type { DeploymentSettingsOverrides } from '@golinks/shared/settings'
import { describe, expect, it } from 'vitest'
import { shellBrandingOf, transformIndexHtml } from './index-html.ts'

/** The shell the web build produces, in the shape this transform expects to find it. */
const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>GoLinks</title>
    <style>
      :root { color-scheme: light dark; background-color: #f6f7fb; }
      :root[data-light] { color-scheme: light; background-color: #f6f7fb; }
      :root[data-dark] { color-scheme: dark; background-color: #0b1020; }
      @media (prefers-color-scheme: dark) { :root { background-color: #0b1020; } }
    </style>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`

function transform(overrides: DeploymentSettingsOverrides): string {
  return transformIndexHtml(SHELL, overrides)
}

describe('shellBrandingOf', () => {
  it('picks out the three fields the first paint can honour', () => {
    expect(
      shellBrandingOf({
        branding: {
          title: 'Acme Links',
          logoUrl: '/_/branding/logo.svg',
          light: { backgroundColor: '#fdfdfd' },
          dark: { backgroundColor: '#101014' },
        },
      }),
    ).toEqual({
      title: 'Acme Links',
      lightBackground: '#fdfdfd',
      darkBackground: '#101014',
    })
  })

  it('finds nothing in a document that fixes something else', () => {
    expect(shellBrandingOf({ readOnly: true, branding: { primaryColor: '#1f4b99' } })).toEqual({
      title: undefined,
      lightBackground: undefined,
      darkBackground: undefined,
    })
  })
})

describe('transformIndexHtml (spec 06 §6)', () => {
  it('leaves the shell byte for byte when the deployment changes nothing about it', () => {
    expect(transform({})).toBe(SHELL)
    expect(transform({ readOnly: true, branding: { primaryColor: '#1f4b99' } })).toBe(SHELL)
  })

  it('replaces the placeholder title', () => {
    const html = transform({ branding: { title: 'Acme Links' } })

    expect(html).toContain('<title>Acme Links</title>')
    expect(html).not.toContain('<title>GoLinks</title>')
  })

  it('escapes a title so it cannot close its own element', () => {
    const html = transform({ branding: { title: 'Acme & Sons </title><script>x</script>' } })

    expect(html).toContain(
      '<title>Acme &amp; Sons &lt;/title&gt;&lt;script&gt;x&lt;/script&gt;</title>',
    )
    expect(html).not.toContain('<script>x</script>')
  })

  it('paints both grounds in the rule structure the shell already uses', () => {
    const html = transform({
      branding: { light: { backgroundColor: '#fdfdfd' }, dark: { backgroundColor: '#101014' } },
    })

    const appended = html.slice(html.indexOf('</style>') + '</style>'.length)
    expect(appended).toContain(':root { background-color: #fdfdfd; }')
    expect(appended).toContain(':root[data-light] { background-color: #fdfdfd; }')
    expect(appended).toContain(':root[data-dark] { background-color: #101014; }')
    expect(appended).toContain(
      '@media (prefers-color-scheme: dark) { :root { background-color: #101014; } }',
    )
    // Appended inside the head, so the shell's own rules are the ones being overridden.
    expect(html.indexOf('</style>\n  </head>')).toBeGreaterThan(-1)
  })

  it('scopes a light ground on its own to the light preference', () => {
    const html = transform({ branding: { light: { backgroundColor: '#fdfdfd' } } })

    // A bare `:root` here would win over the shell's own dark media rule and repaint a
    // dark-preference browser white, which is the flash the shell exists to prevent.
    expect(html).toContain(
      '@media (prefers-color-scheme: light) { :root { background-color: #fdfdfd; } }',
    )
    expect(html).toContain(':root[data-light] { background-color: #fdfdfd; }')
    expect(html).not.toContain(':root[data-dark] { background-color:')
  })

  it('paints a dark ground on its own without touching the light one', () => {
    const html = transform({ branding: { dark: { backgroundColor: '#101014' } } })

    expect(html).toContain(':root[data-dark] { background-color: #101014; }')
    expect(html).toContain(
      '@media (prefers-color-scheme: dark) { :root { background-color: #101014; } }',
    )
    expect(html).not.toContain('background-color: #101014; }\n      :root[data-light]')
  })

  it('carries the title and the grounds together', () => {
    const html = transform({
      branding: {
        title: 'Acme Links',
        light: { backgroundColor: '#fdfdfd' },
        dark: { backgroundColor: '#101014' },
      },
    })

    expect(html).toContain('<title>Acme Links</title>')
    expect(html).toContain('#fdfdfd')
    expect(html).toContain('#101014')
    // The shell is otherwise untouched.
    expect(html).toContain('<div id="root"></div>')
  })

  it('leaves a document with no head or title alone rather than guessing', () => {
    const bare = '<html><body><div id="root"></div></body></html>'

    expect(transformIndexHtml(bare, { branding: { title: 'Acme Links' } })).toBe(bare)
  })
})
