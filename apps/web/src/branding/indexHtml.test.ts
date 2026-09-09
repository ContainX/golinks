import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { UPSTREAM_DARK_GROUND, UPSTREAM_LIGHT_GROUND } from './defaults.ts'
import { applyGroundColors, brandingIndexHtmlPlugin } from './indexHtml.ts'

/** The served document itself, so that the transform is tested against what ships. */
const servedHtml = readFileSync(join(import.meta.dirname, '../../index.html'), 'utf8')

describe('applyGroundColors', () => {
  it('leaves the document alone when the deployment overrides no ground', () => {
    expect(applyGroundColors(servedHtml, {})).toBe(servedHtml)
    expect(applyGroundColors(servedHtml, { light: { primaryColor: '#0f766e' } })).toBe(servedHtml)
  })

  it('paints the deployment’s grounds into the pre-paint style', () => {
    const html = applyGroundColors(servedHtml, {
      light: { backgroundColor: '#fdfbf7' },
      dark: { backgroundColor: '#04110f' },
    })

    expect(html).not.toContain(UPSTREAM_LIGHT_GROUND)
    expect(html).not.toContain(UPSTREAM_DARK_GROUND)
    expect(html).toContain(':root { color-scheme: light dark; background-color: #fdfbf7; }')
    expect(html).toContain(':root[data-dark] { color-scheme: dark; background-color: #04110f; }')
    // Everything else about the document is untouched.
    expect(html).toContain('<title>GoLinks</title>')
    expect(html).toContain('<script type="module" src="/src/main.tsx"></script>')
  })

  it('rewrites one ground without disturbing the other', () => {
    const html = applyGroundColors(servedHtml, { dark: { backgroundColor: '#04110f' } })

    expect(html).toContain(UPSTREAM_LIGHT_GROUND)
    expect(html).not.toContain(UPSTREAM_DARK_GROUND)
  })

  it('rewrites each ground once, even when one is written as the other', () => {
    const html = applyGroundColors(servedHtml, {
      light: { backgroundColor: UPSTREAM_DARK_GROUND },
      dark: { backgroundColor: '#04110f' },
    })

    expect(html).toContain(
      `:root { color-scheme: light dark; background-color: ${UPSTREAM_DARK_GROUND}; }`,
    )
    expect(html).toContain(':root[data-dark] { color-scheme: dark; background-color: #04110f; }')
  })

  it('ignores a ground it cannot use', () => {
    expect(applyGroundColors(servedHtml, { light: { backgroundColor: 'ivory' } })).toBe(servedHtml)
  })
})

describe('brandingIndexHtmlPlugin', () => {
  it('hands the same transform to the build', () => {
    const plugin = brandingIndexHtmlPlugin({ dark: { backgroundColor: '#04110f' } })

    expect(plugin.transformIndexHtml(servedHtml)).toBe(
      applyGroundColors(servedHtml, { dark: { backgroundColor: '#04110f' } }),
    )
  })
})
