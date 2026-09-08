/**
 * Turning a link's numbers and timestamps into the short phrases the directory
 * and the drawer show ("4,812", "2h ago", "Jan 10").
 *
 * Everything here is pure and locale-aware through `Intl`, so a test can pin
 * the clock and read the same string a member would.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const countFormat = new Intl.NumberFormat()
const shortDateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const fullDateFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

/** Visit counts, grouped: `4812` reads as `4,812`. */
export function formatCount(value: number): string {
  return countFormat.format(value)
}

/**
 * How long ago something happened, in the compact form the stats row uses.
 *
 * Anything older than a week is shown as a date instead, because "37d ago" is
 * harder to place than "Jan 10".
 */
export function formatRelativeTime(iso: string | null, now: Date = new Date()): string {
  if (iso === null) {
    return 'Never'
  }
  const then = new Date(iso)
  const elapsed = now.getTime() - then.getTime()
  if (Number.isNaN(elapsed)) {
    return 'Never'
  }
  if (elapsed < MINUTE) {
    return 'Just now'
  }
  if (elapsed < HOUR) {
    return `${Math.floor(elapsed / MINUTE)}m ago`
  }
  if (elapsed < DAY) {
    return `${Math.floor(elapsed / HOUR)}h ago`
  }
  if (elapsed < 7 * DAY) {
    return `${Math.floor(elapsed / DAY)}d ago`
  }
  return shortDateFormat.format(then)
}

/** A creation date, as the drawer's stats row shows it. */
export function formatShortDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : shortDateFormat.format(date)
}

/** A date with its year, for anything a member may need to quote. */
export function formatFullDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : fullDateFormat.format(date)
}

/**
 * When a transfer link stops working (spec 03 §9.2). Expiries are hours away,
 * so the phrasing is "in 6h", falling back to a date for anything longer.
 */
export function formatExpiry(iso: string, now: Date = new Date()): string {
  const expiresAt = new Date(iso)
  const remaining = expiresAt.getTime() - now.getTime()
  if (Number.isNaN(remaining)) {
    return 'unknown'
  }
  if (remaining <= 0) {
    return 'expired'
  }
  if (remaining < HOUR) {
    return `in ${Math.max(1, Math.floor(remaining / MINUTE))}m`
  }
  if (remaining < DAY) {
    return `in ${Math.floor(remaining / HOUR)}h`
  }
  return `on ${formatFullDate(iso)}`
}

/** The two-letter monogram the owner avatars show. */
export function emailInitials(email: string): string {
  const local = email.split('@')[0] ?? email
  const parts = local.split(/[._-]+/).filter((part) => part.length > 0)
  const first = parts[0]?.[0] ?? local[0] ?? '?'
  const second = parts[1]?.[0] ?? local[1] ?? ''
  return `${first}${second}`.toUpperCase()
}
