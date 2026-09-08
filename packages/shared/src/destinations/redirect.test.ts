import { describe, expect, it } from 'vitest'
import { buildRedirectLocation, substitutePlaceholders } from './redirect.ts'

function location(destination: string, values: readonly string[] = []) {
  const result = buildRedirectLocation(destination, values)
  if (!result.ok) throw new Error(`expected success, got ${result.message}`)
  return result.location
}

describe('substitutePlaceholders', () => {
  it('replaces each placeholder positionally', () => {
    expect(substitutePlaceholders('https://github.com/acme/%s/issues/%s', ['web', '42'])).toBe(
      'https://github.com/acme/web/issues/42',
    )
  })

  it('encodes each value as a URL component', () => {
    expect(substitutePlaceholders('https://x/%s', ['a b'])).toBe('https://x/a%20b')
    expect(substitutePlaceholders('https://x/%s', ['a/b'])).toBe('https://x/a%2Fb')
    expect(substitutePlaceholders('https://x/%s', ['a?b#c'])).toBe('https://x/a%3Fb%23c')
    expect(substitutePlaceholders('https://x/%s', ['тест'])).toBe(
      'https://x/%D1%82%D0%B5%D1%81%D1%82',
    )
  })

  it('replaces placeholders beyond the supplied values with the empty string', () => {
    expect(substitutePlaceholders('https://acme.atlassian.net/browse/%s', [])).toBe(
      'https://acme.atlassian.net/browse/',
    )
    expect(substitutePlaceholders('https://x/%s/%s', ['one'])).toBe('https://x/one/')
  })

  it('ignores surplus values', () => {
    expect(substitutePlaceholders('https://x/%s', ['one', 'two'])).toBe('https://x/one')
  })

  it('leaves a destination without placeholders alone', () => {
    expect(substitutePlaceholders('https://wiki.acme.com/handbook', ['ignored'])).toBe(
      'https://wiki.acme.com/handbook',
    )
  })

  it('does not rescan substituted text for new placeholders', () => {
    expect(substitutePlaceholders('https://x/%s/%s', ['%s', 'tail'])).toBe('https://x/%25s/tail')
  })
})

describe('buildRedirectLocation', () => {
  it('redirects a plain destination', () => {
    expect(location('https://wiki.acme.com/handbook')).toBe('https://wiki.acme.com/handbook')
  })

  it('substitutes a captured value, keeping its case', () => {
    expect(location('https://acme.atlassian.net/browse/%s', ['ACME-123'])).toBe(
      'https://acme.atlassian.net/browse/ACME-123',
    )
  })

  it('percent-encodes a captured value containing a space', () => {
    expect(location('https://acme.atlassian.net/browse/%s', ['a b'])).toBe(
      'https://acme.atlassian.net/browse/a%20b',
    )
  })

  it('substitutes several captured values in order', () => {
    expect(location('https://github.com/acme/%s/issues/%s', ['web', '42'])).toBe(
      'https://github.com/acme/web/issues/42',
    )
  })

  it('produces the prefix fallback form when no values are captured', () => {
    expect(location('https://acme.atlassian.net/browse/%s')).toBe(
      'https://acme.atlassian.net/browse/',
    )
  })

  it('converts an internationalized host to its ASCII form', () => {
    expect(location('https://пример.рф/страница')).toBe(
      'https://xn--e1afmkfd.xn--p1ai/%D1%81%D1%82%D1%80%D0%B0%D0%BD%D0%B8%D1%86%D0%B0',
    )
    expect(location('https://例え.テスト/%s', ['パス'])).toBe(
      'https://xn--r8jz45g.xn--zckzah/%E3%83%91%E3%82%B9',
    )
  })

  it('produces an ASCII-only Location value', () => {
    const value = location('https://пример.рф/%s', ['тест'])
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting the header is ASCII
    expect(value).toMatch(/^[\x00-\x7F]*$/)
  })

  it('serializes a bare host to include the root path', () => {
    expect(location('https://wiki')).toBe('https://wiki/')
  })

  it('preserves the query string of the destination', () => {
    expect(location('https://example.com/search?q=%s', ['go links'])).toBe(
      'https://example.com/search?q=go%20links',
    )
  })

  it('reports a destination that cannot be serialized instead of throwing', () => {
    const result = buildRedirectLocation('https://%s', [])
    expect(result).toMatchObject({ ok: false, code: 'destination_unserializable' })
  })

  it('reports a stored destination that predates a rule change', () => {
    const result = buildRedirectLocation('not a url at all')
    expect(result).toMatchObject({ ok: false, code: 'destination_unserializable' })
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toMatch(/could not be serialized/)
  })
})
