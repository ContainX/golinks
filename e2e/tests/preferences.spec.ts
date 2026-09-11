// The color scheme a member settles for themselves, and the promise that it is remembered
// (ADR 0002 §5, §10, spec 01 §2.5).
//
// It is stored against the account rather than the browser, so the check that matters is not
// that the page changed but that it is still changed on the next visit, and that it survives a
// browser with nothing left in its storage.

import { expect, test } from '@playwright/test'
import { openUserMenu, patchedMe } from './support/screens.ts'
import { ORGANIZATIONS, signIn, uniqueEmail } from './support/sign-in.ts'

test('a member fixes the color scheme to dark and it stays', async ({ page }) => {
  const email = uniqueEmail(ORGANIZATIONS.widgets)
  await signIn(page, email)

  // Material UI switches schemes with a `data-<scheme>` attribute on the document element.
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-light', '')

  await openUserMenu(page, email)
  await Promise.all([patchedMe(page), page.getByRole('button', { name: 'Dark' }).click()])
  await expect(html).toHaveAttribute('data-dark', '')

  await page.reload()
  await expect(html).toHaveAttribute('data-dark', '')

  // The account is what holds the choice: with the browser's own copy cleared, the scheme still
  // comes back from the member's preferences.
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(html).toHaveAttribute('data-dark', '')
})
