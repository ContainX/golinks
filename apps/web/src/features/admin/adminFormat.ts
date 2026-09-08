/**
 * Turning the values the admin endpoints return into the short phrases the
 * tables show ("JD", "2h ago", "Sep 7, 14:03", "12 links").
 *
 * Everything here is pure and takes the clock as an argument where it needs
 * one, so a test reads exactly what a member would see.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const shortDateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** Separators an email's local part is built from: `jane.doe`, `sam_k`, `li-w`. */
const NAME_SEPARATORS = /[.\-_+]+/

/**
 * The one or two letters an avatar stands in with.
 *
 * All the app knows about a member is their email address (spec 05 §2.3), so
 * the initials come from its local part: the first letter of each of its first
 * two words, or its first two letters when it is a single word.
 */
export function memberInitials(email: string): string {
  const localPart = email.split('@')[0] ?? email
  const words = localPart.split(NAME_SEPARATORS).filter((word) => word.length > 0)
  if (words.length === 0) {
    return '?'
  }
  const [first, second] = words
  if (first === undefined) {
    return '?'
  }
  if (second === undefined) {
    return first.slice(0, 2).toUpperCase()
  }
  return `${first[0] ?? ''}${second[0] ?? ''}`.toUpperCase()
}

/**
 * How long ago something happened, in the compact form the tables use.
 *
 * Anything older than a week is shown as a date instead, because "37d ago" is
 * harder to place than "Mar 3". A member who has never signed in has no
 * timestamp at all, which reads as "Never".
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

/**
 * When an audit event happened, to the minute.
 *
 * The trail is read against wall-clock memory ("what changed this morning"), so
 * it is shown in the reader's own time zone rather than the UTC the API sends.
 */
export function formatEventTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateTimeFormat.format(date)
}

/** How many links a member owns, as the table's cell reads it. */
export function formatLinkCount(count: number): string {
  return count === 1 ? '1 link' : `${count} links`
}
