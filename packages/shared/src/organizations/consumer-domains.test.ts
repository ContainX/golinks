import { describe, expect, it } from 'vitest'
import { CONSUMER_EMAIL_DOMAINS, isConsumerEmailDomain } from './consumer-domains.ts'

describe('CONSUMER_EMAIL_DOMAINS', () => {
  it('covers the major providers worldwide', () => {
    for (const domain of [
      'gmail.com',
      'googlemail.com',
      'outlook.com',
      'hotmail.com',
      'live.com',
      'msn.com',
      'yahoo.com',
      'yahoo.co.uk',
      'yahoo.co.jp',
      'icloud.com',
      'me.com',
      'mac.com',
      'aol.com',
      'protonmail.com',
      'proton.me',
      'pm.me',
      'gmx.com',
      'gmx.de',
      'gmx.net',
      'web.de',
      't-online.de',
      'mail.com',
      'zoho.com',
      'yandex.com',
      'yandex.ru',
      'mail.ru',
      'qq.com',
      '163.com',
      '126.com',
      'naver.com',
      'daum.net',
      'fastmail.com',
      'hey.com',
      'tutanota.com',
      'tuta.io',
    ]) {
      expect(CONSUMER_EMAIL_DOMAINS).toContain(domain)
    }
  })

  it('lists at least sixty providers', () => {
    expect(CONSUMER_EMAIL_DOMAINS.length).toBeGreaterThanOrEqual(60)
  })

  it('has no duplicates', () => {
    expect(new Set(CONSUMER_EMAIL_DOMAINS).size).toBe(CONSUMER_EMAIL_DOMAINS.length)
  })

  it('is entirely lowercase and free of whitespace', () => {
    for (const domain of CONSUMER_EMAIL_DOMAINS) {
      expect(domain).toBe(domain.toLowerCase().trim())
      expect(domain).toMatch(/^[a-z0-9.-]+$/)
    }
  })

  it('does not list corporate domains', () => {
    for (const domain of ['acme.com', 'example.com', 'anthropic.com']) {
      expect(CONSUMER_EMAIL_DOMAINS).not.toContain(domain)
    }
  })
})

describe('isConsumerEmailDomain', () => {
  it('recognizes a listed domain', () => {
    expect(isConsumerEmailDomain('gmail.com')).toBe(true)
  })

  it('does not recognize a corporate domain', () => {
    expect(isConsumerEmailDomain('acme.com')).toBe(false)
  })

  it('ignores case and surrounding whitespace', () => {
    expect(isConsumerEmailDomain('  GMAIL.com ')).toBe(true)
  })

  it('does not match a subdomain of a listed domain', () => {
    expect(isConsumerEmailDomain('mail.gmail.com')).toBe(false)
  })
})
