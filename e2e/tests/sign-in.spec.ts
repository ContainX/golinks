// The sign-in page in the two states a member reaches it in without a session (ADR 0002 §6,
// spec 02 §2.1, §4).
//
// A refused sign-in has to say which of the six things went wrong, in words that tell the
// member whether to try again or to ask an administrator; signing out has to actually end the
// session rather than only navigate away from it.

import { expect, test } from '@playwright/test'
import { openUserMenu } from './support/screens.ts'
import { ORGANIZATIONS, signIn, uniqueEmail } from './support/sign-in.ts'

test('a disabled account is told so on the sign-in page', async ({ page }) => {
  await page.goto('/_/login?error=account_disabled')

  await expect(page.getByRole('heading', { name: 'Sign in to' })).toBeVisible()
  await expect(page.getByText('Your account has been disabled by an administrator.')).toBeVisible()
})

test('signing out from the user menu ends the session', async ({ page }) => {
  // The user menu signs out by submitting a form (spec 02 §4, §6); the API accepts the
  // empty urlencoded body that carries and ends the session.

  const email = uniqueEmail(ORGANIZATIONS.widgets)
  await signIn(page, email)

  await openUserMenu(page, email)
  await page.getByRole('menuitem', { name: 'Sign out' }).click()

  await expect(page).toHaveURL(/\/_\/login\?signedOut=1$/)
  await expect(page.getByText('You are signed out.')).toBeVisible()

  const me = await page.request.get('/_/api/v1/me')
  expect(me.status()).toBe(401)
})
