// Where a keyword nobody has created lands, and what a member can do about it there
// (ADR 0002 §4, spec 04 §8).
//
// The resolver answers a miss with a redirect carrying the keyword, and the screen that
// receives it asks one question — where should this point — with the keyword already locked in.
// Creating from there has to leave a link the resolver then answers, which is what closes the
// loop the member started by typing it.

import { expect, test } from '@playwright/test'
import { DESTINATION, goPath } from './support/screens.ts'
import { ORGANIZATIONS, signIn, uniqueEmail, uniqueKeyword } from './support/sign-in.ts'

test('a keyword nobody created is offered for creation and then resolves', async ({ page }) => {
  await signIn(page, uniqueEmail(ORGANIZATIONS.widgets))
  const keyword = uniqueKeyword()

  await page.goto(`/${keyword}`)
  await expect(page).toHaveURL(new RegExp(`/_/\\?keyword=${keyword}`))

  await expect(
    page.getByRole('heading', { name: `${goPath(keyword)} doesn't exist yet` }),
  ).toBeVisible()
  // The keyword is shown as typed, locked in rather than asked for again.
  await expect(page.getByText(goPath(keyword), { exact: true })).toBeVisible()
  await expect(page.getByText('Keyword as you typed it')).toBeVisible()

  await page.getByRole('textbox', { name: 'Destination', exact: true }).fill(DESTINATION)
  await page.getByRole('button', { name: `Create ${goPath(keyword)}` }).click()

  // A new link opens on its own address, which is the directory with its drawer over it.
  await expect(page).toHaveURL(/\/_\/links\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { name: goPath(keyword) })).toBeVisible()

  await page.goto(`/${keyword}`)
  await expect(page).toHaveURL(DESTINATION)
})
