// Administration: the two things an admin does to a member who is leaving, and what the area
// says to everyone else (ADR 0002 §7, spec 08 §8).
//
// Disabling and reassigning belong together because they are one act: a member leaves, their
// account stops working, and the links they owned have to keep working under someone else's
// name. The second scenario is the other half of the same rule — administration is not merely
// hidden from a member, it refuses them.

import { expect, test } from '@playwright/test'
import { DESTINATION, findInDirectory } from './support/screens.ts'
import {
  ADMIN_EMAIL,
  createLink,
  ORGANIZATIONS,
  signIn,
  uniqueEmail,
  uniqueKeyword,
} from './support/sign-in.ts'

test('an admin disables a member and hands their links to another', async ({ browser }) => {
  const leavingEmail = uniqueEmail(ORGANIZATIONS.widgets)
  // The successor is chosen from a page of members ordered by address, so this one is named to
  // sort near the front however many members the deployment has accumulated.
  const successorEmail = uniqueEmail(ORGANIZATIONS.widgets, 'a-successor')
  const keyword = uniqueKeyword()

  const leaving = await browser.newContext()
  const leavingPage = await leaving.newPage()
  await signIn(leavingPage, leavingEmail)
  await createLink(leavingPage.request, { keyword, destination: DESTINATION })
  await leaving.close()

  // A member exists once they have signed in, and only an enabled one may own a link.
  const successor = await browser.newContext()
  await signIn(await successor.newPage(), successorEmail)
  await successor.close()

  const adminContext = await browser.newContext()
  const page = await adminContext.newPage()
  await signIn(page, ADMIN_EMAIL)
  await page.goto('/_/admin/users')

  await page.getByLabel('Search members').fill(leavingEmail)
  const row = page.getByRole('row').filter({ hasText: leavingEmail })
  await expect(row).toContainText('Active')
  await expect(row).toContainText('1 link')

  await row.getByRole('button', { name: `Actions for ${leavingEmail}` }).click()
  await page.getByRole('menuitem', { name: 'Disable' }).click()
  await expect(page.getByText(`${leavingEmail} can no longer sign in.`)).toBeVisible()
  await expect(row).toContainText('Disabled')

  await row.getByRole('button', { name: `Actions for ${leavingEmail}` }).click()
  await page.getByRole('menuitem', { name: 'Reassign links' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(`Reassign ${leavingEmail}'s links`)
  await dialog.getByRole('combobox', { name: 'New owner' }).fill(successorEmail)
  await page.getByRole('option', { name: successorEmail }).click()
  await dialog.getByRole('button', { name: 'Reassign 1 link' }).click()
  await expect(page.getByText(`Moved 1 link to ${successorEmail}.`)).toBeVisible()

  // The links kept working; they belong to someone else now.
  await page.goto('/')
  await expect(await findInDirectory(page, keyword)).toContainText(successorEmail)

  await adminContext.close()
})

test('a member is offered no administration, and is refused it', async ({ page }) => {
  await signIn(page, uniqueEmail(ORGANIZATIONS.widgets))

  const sections = page.getByRole('navigation', { name: 'Sections' })
  await expect(sections.getByRole('link', { name: 'Directory' })).toBeVisible()
  await expect(sections.getByRole('link', { name: 'Admin' })).toHaveCount(0)

  await page.goto('/_/admin')
  const refusal = page.getByRole('alert').filter({ hasText: 'Admins only' })
  await expect(refusal).toContainText(`Administering ${ORGANIZATIONS.widgets} is limited to its`)
  await expect(page.getByRole('tab', { name: 'Settings' })).toHaveCount(0)
})
