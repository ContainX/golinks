/**
 * Copying a short form to the clipboard (spec 08 §3).
 *
 * The Clipboard API is not available on an insecure origin and can be refused
 * by permission, so a failure is reported rather than thrown: the caller says
 * "copied" or "could not copy" and the member is never left wondering which
 * happened.
 */

export async function copyToClipboard(text: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (!clipboard) {
    return false
  }
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
