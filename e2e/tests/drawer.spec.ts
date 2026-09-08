// The link drawer in its three views, and the deletion that empties it (ADR 0002 §3, spec 03 §5).
//
// One screen at `/_/links/:id` reads differently for three people: its owner edits it, another
// member is told who to ask, and an admin can additionally hand it to someone else. The three
// are checked against the same link, because the point of the permission matrix is that the
// same resource answers each of them differently.

import { expect, test } from '@playwright/test'
import {
  DESTINATION,
  findInDirectory,
  goPath,
  notice,
  OTHER_DESTINATION,
} from './support/screens.ts'
import {
  ADMIN_EMAIL,
  createLink,
  ORGANIZATIONS,
  signIn,
  uniqueEmail,
  uniqueKeyword,
} from './support/sign-in.ts'

test("the owner changes a link's destination from the row's edit action", async ({ page }) => {
  await signIn(page, uniqueEmail(ORGANIZATIONS.widgets))
  const keyword = uniqueKeyword()
  await createLink(page.request, { keyword, destination: DESTINATION })

  await page.goto('/')
  const row = await findInDirectory(page, keyword)
  await row.getByRole('button', { name: `Edit ${goPath(keyword)}` }).click()
  await expect(page).toHaveURL(/\/_\/links\/[0-9a-f-]+$/)

  const destination = page.getByRole('textbox', { name: 'Destination', exact: true })
  await expect(destination).toHaveValue(DESTINATION)
  await destination.fill(OTHER_DESTINATION)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(notice(page, `Saved ${goPath(keyword)}`)).toBeVisible()

  await page.goto(`/${keyword}`)
  await expect(page).toHaveURL(OTHER_DESTINATION)
})

test('another member reads the link, and an admin hands it to them', async ({ browser }) => {
  const ownerEmail = uniqueEmail(ORGANIZATIONS.widgets)
  const memberEmail = uniqueEmail(ORGANIZATIONS.widgets)
  const keyword = uniqueKeyword()

  const ownerContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  await signIn(ownerPage, ownerEmail)
  const link = await createLink(ownerPage.request, { keyword, destination: DESTINATION })

  // The other member: everything readable, nothing changeable, and the owner named.
  const memberContext = await browser.newContext()
  const memberPage = await memberContext.newPage()
  await signIn(memberPage, memberEmail)
  await memberPage.goto(`/_/links/${link.id}`)

  const ownership = memberPage.getByRole('alert').filter({ hasText: ownerEmail })
  await expect(ownership).toContainText('Only the owner or an admin can change this link')
  await expect(memberPage.getByRole('button', { name: 'Save changes' })).toHaveCount(0)
  await expect(memberPage.getByRole('button', { name: `Copy ${goPath(keyword)}` })).toBeVisible()

  // The admin: the same screen, with the owner as a field of its own (spec 03 §9.1).
  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await signIn(adminPage, ADMIN_EMAIL)
  await adminPage.goto(`/_/links/${link.id}`)
  await expect(adminPage.getByText('Editing as admin')).toBeVisible()

  await adminPage.getByRole('combobox', { name: 'Owner' }).fill(memberEmail)
  await adminPage.getByRole('option', { name: memberEmail }).click()
  await adminPage.getByRole('button', { name: 'Save changes' }).click()
  await expect(notice(adminPage, `Saved ${goPath(keyword)}`)).toBeVisible()

  await adminPage.goto('/')
  await expect(await findInDirectory(adminPage, keyword)).toContainText(memberEmail)

  await Promise.all([ownerContext.close(), memberContext.close(), adminContext.close()])
})

test('the owner deletes a link and the keyword is free again', async ({ page }) => {
  await signIn(page, uniqueEmail(ORGANIZATIONS.widgets))
  const keyword = uniqueKeyword()
  await createLink(page.request, { keyword, destination: DESTINATION })

  await page.goto('/')
  const row = await findInDirectory(page, keyword)
  await row.getByRole('button', { name: `More actions for ${goPath(keyword)}` }).click()
  await page.getByRole('menuitem', { name: 'Delete link' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(`Delete ${goPath(keyword)}?`)
  await expect(dialog).toContainText('This cannot be undone.')
  await dialog.getByRole('button', { name: 'Delete link' }).click()

  await expect(notice(page, `Deleted ${goPath(keyword)}`)).toBeVisible()
  await expect(row).toHaveCount(0)

  await page.goto(`/${keyword}`)
  await expect(
    page.getByRole('heading', { name: `${goPath(keyword)} doesn't exist yet` }),
  ).toBeVisible()
})
