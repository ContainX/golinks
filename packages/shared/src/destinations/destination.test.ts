import { describe, expect, it } from 'vitest'
import {
  applyDefaultDestinationScheme,
  countDestinationPlaceholders,
  evaluateDestination,
  hasExplicitScheme,
  MAX_DESTINATION_LENGTH,
} from './destination.ts'

function succeed(input: string) {
  const result = evaluateDestination(input)
  if (!result.ok) throw new Error(`expected success, got ${result.reason}: ${result.message}`)
  return result
}

function fail(input: string) {
  const result = evaluateDestination(input)
  if (result.ok) throw new Error(`expected "${input}" to be rejected`)
  return result
}

describe('hasExplicitScheme', () => {
  it('needs a scheme followed by //', () => {
    expect(hasExplicitScheme('https://example.com')).toBe(true)
    expect(hasExplicitScheme('http://example.com')).toBe(true)
    expect(hasExplicitScheme('ftp://example.com')).toBe(true)
    expect(hasExplicitScheme('example.com')).toBe(false)
    expect(hasExplicitScheme('javascript:alert(1)')).toBe(false)
    expect(hasExplicitScheme('example.com:8080/path')).toBe(false)
    expect(hasExplicitScheme('//example.com')).toBe(false)
  })
})

describe('applyDefaultDestinationScheme', () => {
  it('trims and prepends https:// when there is no scheme', () => {
    expect(applyDefaultDestinationScheme('  example.com/docs  ')).toBe('https://example.com/docs')
  })

  it('leaves an explicit scheme alone', () => {
    expect(applyDefaultDestinationScheme('http://example.com')).toBe('http://example.com')
  })

  it('leaves an empty value empty', () => {
    expect(applyDefaultDestinationScheme('   ')).toBe('')
  })
})

describe('evaluateDestination', () => {
  it('stores the trimmed value with the default scheme, not the re-serialized form', () => {
    expect(succeed('  wiki.acme.com/handbook  ').destination).toBe('https://wiki.acme.com/handbook')
    expect(succeed('https://example.com').destination).toBe('https://example.com')
  })

  it('does not re-serialize a destination the parser would normalize', () => {
    expect(succeed('https://пример.рф/страница').destination).toBe('https://пример.рф/страница')
    expect(succeed('https://EXAMPLE.com/A B').destination).toBe('https://EXAMPLE.com/A B')
  })

  it('accepts a bare hostname', () => {
    expect(succeed('example.com').destination).toBe('https://example.com')
  })

  it('accepts a single-label intranet hostname', () => {
    expect(succeed('wiki').destination).toBe('https://wiki')
    expect(succeed('http://wiki/start').destination).toBe('http://wiki/start')
  })

  it('accepts IPv4 and IPv6 addresses', () => {
    expect(succeed('10.0.0.5/status').destination).toBe('https://10.0.0.5/status')
    expect(succeed('http://192.168.1.1:8080/x').destination).toBe('http://192.168.1.1:8080/x')
    expect(succeed('http://[::1]:8080/x').destination).toBe('http://[::1]:8080/x')
  })

  it('accepts internationalized domain names', () => {
    expect(succeed('пример.рф').destination).toBe('https://пример.рф')
    expect(succeed('https://例え.テスト/パス').ok).toBe(true)
  })

  it('accepts http and https', () => {
    expect(succeed('http://example.com').ok).toBe(true)
    expect(succeed('https://example.com').ok).toBe(true)
  })

  it('rejects javascript: destinations', () => {
    expect(fail('javascript:alert(1)')).toMatchObject({
      code: 'destination_invalid',
      reason: 'unparsable',
    })
    expect(fail('JavaScript:alert(1)')).toMatchObject({ code: 'destination_invalid' })
    expect(fail('javascript://example.com/%0aalert(1)')).toMatchObject({
      code: 'destination_invalid',
      reason: 'scheme_not_allowed',
    })
  })

  it('rejects data: destinations', () => {
    expect(fail('data:text/html,<h1>hi</h1>')).toMatchObject({
      code: 'destination_invalid',
      reason: 'unparsable',
    })
    expect(fail('data://example.com/x')).toMatchObject({ reason: 'scheme_not_allowed' })
  })

  it('rejects file: and other schemes', () => {
    expect(fail('file:///etc/hosts')).toMatchObject({ reason: 'scheme_not_allowed' })
    expect(fail('ftp://example.com/pub')).toMatchObject({ reason: 'scheme_not_allowed' })
    expect(fail('ws://example.com/socket')).toMatchObject({ reason: 'scheme_not_allowed' })
  })

  it('names the offending scheme in the message', () => {
    expect(fail('ftp://example.com/pub').message).toMatch(/ftp/)
  })

  it('rejects an empty destination', () => {
    expect(fail('')).toMatchObject({ reason: 'empty' })
    expect(fail('    ')).toMatchObject({ reason: 'empty' })
  })

  it('rejects a value the parser cannot handle', () => {
    expect(fail('https://')).toMatchObject({ reason: 'unparsable' })
    expect(fail('http://:8080')).toMatchObject({ reason: 'unparsable' })
  })

  it('accepts a destination of exactly the maximum length', () => {
    const prefix = 'https://example.com/'
    const destination = prefix + 'a'.repeat(MAX_DESTINATION_LENGTH - prefix.length)
    expect(destination).toHaveLength(MAX_DESTINATION_LENGTH)
    expect(succeed(destination).ok).toBe(true)
  })

  it('rejects a destination one character too long', () => {
    const prefix = 'https://example.com/'
    const destination = prefix + 'a'.repeat(MAX_DESTINATION_LENGTH - prefix.length + 1)
    expect(fail(destination)).toMatchObject({ reason: 'too_long' })
  })

  it('measures the length after the scheme is added', () => {
    const value = `example.com/${'a'.repeat(MAX_DESTINATION_LENGTH - 12)}`
    expect(value).toHaveLength(MAX_DESTINATION_LENGTH)
    expect(fail(value)).toMatchObject({ reason: 'too_long' })
  })

  it('counts placeholders', () => {
    expect(succeed('https://acme.atlassian.net/browse/%s').placeholderCount).toBe(1)
    expect(succeed('https://github.com/acme/%s/issues/%s').placeholderCount).toBe(2)
    expect(succeed('https://wiki.acme.com/handbook').placeholderCount).toBe(0)
  })

  it('does not count a percent sign that is not a placeholder', () => {
    expect(succeed('https://example.com/100%25').placeholderCount).toBe(0)
    expect(succeed('https://example.com/%S').placeholderCount).toBe(0)
  })

  it('may point back at this service', () => {
    expect(succeed('https://links.example.com/handbook').ok).toBe(true)
  })
})

describe('countDestinationPlaceholders', () => {
  it('counts every occurrence', () => {
    expect(countDestinationPlaceholders('https://x/%s/%s/%s')).toBe(3)
    expect(countDestinationPlaceholders('https://x')).toBe(0)
  })
})
