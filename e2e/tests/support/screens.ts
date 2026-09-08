// The handles the app's own screens offer, gathered so that each scenario reads as the flow
// it describes rather than as a list of selectors (ADR 0002).
//
// Everything here is an accessible role, an accessible name, or the text a member reads, for
// two reasons: those are what the screens promise, and a scenario written against them fails
// when the promise breaks rather than when a class name is renamed.

import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { baseURL } from '../../playwright.config.ts'

/**
 * Destinations this deployment serves itself, so that following a link stays on this host.
 *
 * Both are pages a browser renders rather than downloads, which is what lets a scenario assert
 * that it landed on one.
 */
export const DESTINATION = `${baseURL}/_/health/live`
export const OTHER_DESTINATION = `${baseURL}/_/health/ready`

/** The hostname members type before a keyword on a stock deployment (spec 06 §2). */
export const SHORT_HOST = 'go'

/**
 * `go/<keyword>`.
 *
 * The label the app gives a link in the default namespace and the short form it copies are the
 * same string on a deployment whose short host and default namespace are both `go`, which is
 * every deployment these scenarios run against.
 */
export function goPath(keyword: string): string {
  return `${SHORT_HOST}/${keyword}`
}

/**
 * A one-line confirmation the app hands back ("Copied go/handbook", "Saved go/handbook").
 *
 * Matched by its text rather than by its `alert` role: a snackbar is rendered inside the screen
 * that raised it, so while a drawer or a dialog is open it sits under the `aria-hidden` the
 * modal puts on the rest of the page and is no longer reachable by role.
 */
export function notice(page: Page, message: string): Locator {
  return page.getByText(message, { exact: true })
}

/** The directory row for a keyword, whichever page of the table it is on. */
export function directoryRow(page: Page, keyword: string): Locator {
  return page.getByRole('row').filter({ hasText: keyword })
}

/**
 * Narrows the directory to one keyword and waits for its row.
 *
 * The listing is sorted by visits and paged (spec 03 §10.1), so a link nobody has used yet is
 * only reliably on screen once it has been searched for.
 */
export async function findInDirectory(page: Page, keyword: string): Promise<Locator> {
  await page.getByLabel('Search links').fill(keyword)
  // Searching is debounced and re-runs the listing, which replaces the rows. Waiting for the
  // count under the table means the row that comes back is the settled one rather than a row
  // from the unfiltered listing that is about to be swapped out from under a click.
  await expect(page.getByText('1 link shown')).toBeVisible()
  const row = directoryRow(page, keyword)
  await expect(row).toBeVisible()
  return row
}

/** Fills the create bar above the directory and presses Create (ADR 0002 §1). */
export async function createFromBar(
  page: Page,
  keyword: string,
  destination: string,
): Promise<void> {
  await page.getByRole('textbox', { name: 'Keyword', exact: true }).fill(keyword)
  await page.getByRole('textbox', { name: 'Destination', exact: true }).fill(destination)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
}

/** Opens the account menu, which is titled with the member's own address (ADR 0002 §5). */
export async function openUserMenu(page: Page, email: string): Promise<void> {
  await page.getByRole('button', { name: email }).click()
}

/** Waits for a write against the signed-in member to be acknowledged (spec 05 §3). */
export async function patchedMe(page: Page): Promise<unknown> {
  return page.waitForResponse(
    (response) =>
      response.url().endsWith('/_/api/v1/me') &&
      response.request().method() === 'PATCH' &&
      response.ok(),
  )
}
