// Duration strings used by deployment configuration (spec 06 §1): `30d`, `12h`, `15m`, `90s`.
// `ms` is accepted as well so that tests can express very short windows.

const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)$/

const UNIT_IN_MS = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const

export type DurationUnit = keyof typeof UNIT_IN_MS

/** The units a duration string may carry, longest first, for error messages. */
export const DURATION_UNITS: readonly DurationUnit[] = ['d', 'h', 'm', 's', 'ms']

/** Parses `30d` into milliseconds. Returns undefined when the text is not a duration. */
export function tryParseDuration(value: string): number | undefined {
  const match = DURATION_PATTERN.exec(value.trim())
  if (!match) return undefined
  const [, amount, unit] = match
  if (amount === undefined || unit === undefined) return undefined
  const milliseconds = Number(amount) * UNIT_IN_MS[unit as DurationUnit]
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined
}

/** Parses `30d` into milliseconds. Throws on anything else. */
export function parseDuration(value: string): number {
  const milliseconds = tryParseDuration(value)
  if (milliseconds === undefined) {
    throw new RangeError(
      `"${value}" is not a duration; use a whole number followed by ${DURATION_UNITS.join(', ')}`,
    )
  }
  return milliseconds
}

/** Renders milliseconds back into the shortest exact duration string, for logs. */
export function formatDuration(milliseconds: number): string {
  for (const unit of DURATION_UNITS) {
    const size = UNIT_IN_MS[unit]
    if (milliseconds >= size && milliseconds % size === 0) return `${milliseconds / size}${unit}`
  }
  return `${milliseconds}ms`
}
