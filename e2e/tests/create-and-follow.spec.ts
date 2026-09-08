// Creating a link and using it, through the screens a member actually touches
// (ADR 0002 §1, spec 08 §3, §4).
//
// This is the shortest path through the product: type a keyword and a destination into the bar
// above the directory, see the link in the table as yours, copy its short form, and type the
// keyword to land on the page. The keyword the second half creates again is the one collision
// every organization meets, and the notice that answers it is the whole point of spec 08 §4.

import { expect, test } from '@playwright/test'
import {
  createFromBar,
  DESTINATION,
  directoryRow,
  goPath,
  notice,
  OTHER_DESTINATION,
} from './support/screens.ts'
import { ORGANIZATIONS, signIn, uniqueEmail, uniqueKeyword } from './support/sign-in.ts'

// Copying is one of the four row actions, and the Clipboard API is refused without them.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

test('a member creates a link from the bar, copies it, and follows it', async ({ page }) => {
  await signIn(page, uniqueEmail(ORGANIZATIONS.widgets))
  const keyword = uniqueKeyword()

  await createFromBar(page, keyword, DESTINATION)

  const row = directoryRow(page, keyword)
  await expect(row).toBeVisible()
  await expect(row).toContainText(goPath(keyword))
  await expect(row).toContainText(DESTINATION)
  // A member's own links read as theirs rather than as their address (spec 08 §3).
  await expect(row).toContainText('you')

  await row.getByRole('button', { name: `Copy ${goPath(keyword)}` }).click()
  await expect(notice(page, `Copied ${goPath(keyword)}`)).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(goPath(keyword))

  // A full page load, because the resolver owns keyword paths (spec 04 §1).
  await page.goto(`/${keyword}`)
  await expect(page).toHaveURL(DESTINATION)
})

test('creating a keyword that exists offers the link it collided with', async ({ page }) => {
  await signIn(page, uniqueEmail(ORGANIZATIONS.widgets))
  const keyword = uniqueKeyword()

  await createFromBar(page, keyword, DESTINATION)
  await expect(directoryRow(page, keyword)).toBeVisible()

  await createFromBar(page, keyword, OTHER_DESTINATION)

  const collision = page
    .getByRole('alert')
    .filter({ hasText: `${goPath(keyword)} already exists.` })
  await expect(collision).toContainText(`${goPath(keyword)} goes to ${DESTINATION}`)

  await collision.getByRole('button', { name: 'Open' }).click()
  await expect(page).toHaveURL(/\/_\/links\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { name: goPath(keyword) })).toBeVisible()
})
