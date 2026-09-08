import { describe, expect, it } from 'vitest'
import {
  formatEventTime,
  formatLinkCount,
  formatRelativeTime,
  memberInitials,
} from './adminFormat.ts'

describe('member initials', () => {
  it('takes one letter from each of the first two words of the address', () => {
    expect(memberInitials('jane.doe@acme.com')).toBe('JD')
    expect(memberInitials('li-w@acme.com')).toBe('LW')
    expect(memberInitials('sam_k+links@acme.com')).toBe('SK')
  })

  it('falls back to the first two letters of a single word', () => {
    expect(memberInitials('priya@acme.com')).toBe('PR')
    expect(memberInitials('a@acme.com')).toBe('A')
  })
})

describe('relative time', () => {
  const now = new Date('2026-09-07T14:00:00Z')

  it('reads as a distance for anything within the week', () => {
    expect(formatRelativeTime('2026-09-07T13:59:40Z', now)).toBe('Just now')
    expect(formatRelativeTime('2026-09-07T13:20:00Z', now)).toBe('40m ago')
    expect(formatRelativeTime('2026-09-07T12:00:00Z', now)).toBe('2h ago')
    expect(formatRelativeTime('2026-09-04T14:00:00Z', now)).toBe('3d ago')
  })

  it('reads as a date beyond it', () => {
    expect(formatRelativeTime('2026-03-03T09:00:00Z', now)).toMatch(/Mar/)
  })

  it('says a member has never signed in', () => {
    expect(formatRelativeTime(null, now)).toBe('Never')
    expect(formatRelativeTime('not a timestamp', now)).toBe('Never')
  })
})

describe('event time', () => {
  it('is shown in the time zone of whoever is reading it', () => {
    const local = new Date(2026, 8, 7, 14, 3)
    expect(formatEventTime(local.toISOString())).toContain('Sep 7')
  })

  it('hands back an unreadable timestamp as it arrived', () => {
    expect(formatEventTime('whenever')).toBe('whenever')
  })
})

describe('link counts', () => {
  it('agrees with itself about the singular', () => {
    expect(formatLinkCount(0)).toBe('0 links')
    expect(formatLinkCount(1)).toBe('1 link')
    expect(formatLinkCount(31)).toBe('31 links')
  })
})
