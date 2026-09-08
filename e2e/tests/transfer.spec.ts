// Handing a link to a colleague, end to end (spec 03 §9.2, spec 08 §6, ADR 0002 §3).
//
// A transfer is a URL rather than a member picker, so the scenario is genuinely two people: one
// browser context mints the URL from the drawer, another opens it, reads what is being offered,
// and accepts. Opening it a second time has to say that it is spent, because a URL that keeps
// looking live after it has been used is how a link ends up transferred twice.

import { expect, test } from '@playwright/test'
import { DESTINATION, findInDirectory, goPath } from './support/screens.ts'
import { createLink, ORGANIZATIONS, signIn, uniqueEmail, uniqueKeyword } from './support/sign-in.ts'

test('an owner hands a link on, and the transfer URL is spent afterwards', async ({ browser }) => {
  const ownerEmail = uniqueEmail(ORGANIZATIONS.widgets)
  const receiverEmail = uniqueEmail(ORGANIZATIONS.widgets)
  const keyword = uniqueKeyword()

  const ownerContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  await signIn(ownerPage, ownerEmail)
  const link = await createLink(ownerPage.request, { keyword, destination: DESTINATION })

  await ownerPage.goto(`/_/links/${link.id}`)
  await ownerPage.getByRole('button', { name: 'Transfer' }).click()

  const dialog = ownerPage.getByRole('dialog')
  await expect(dialog).toContainText(`Transfer ${goPath(keyword)}`)
  const transferUrl = await dialog.getByRole('textbox', { name: 'Transfer link' }).inputValue()
  expect(transferUrl).toContain('/_/transfer/')

  const receiverContext = await browser.newContext()
  const receiverPage = await receiverContext.newPage()
  await signIn(receiverPage, receiverEmail)
  await receiverPage.goto(transferUrl)

  // What is being offered, before the button that accepts it.
  await expect(
    receiverPage.getByRole('heading', { name: `Take ownership of ${goPath(keyword)}?` }),
  ).toBeVisible()
  await expect(receiverPage.getByText('Current owner')).toBeVisible()
  await expect(receiverPage.getByText(ownerEmail, { exact: true })).toBeVisible()

  await receiverPage.getByRole('button', { name: 'Take ownership' }).click()

  // Accepting lands on the link's own address, now owned by the member who accepted.
  await expect(receiverPage).toHaveURL(new RegExp(`/_/links/${link.id}$`))
  await expect(receiverPage.getByText(`${receiverEmail} (you)`)).toBeVisible()

  // And the directory the link left says so too.
  await ownerPage.goto('/')
  await expect(await findInDirectory(ownerPage, keyword)).toContainText(receiverEmail)

  await receiverPage.goto(transferUrl)
  await expect(receiverPage.getByRole('heading', { name: 'Already accepted' })).toBeVisible()
  await expect(receiverPage.getByText('This transfer link has already been used.')).toBeVisible()

  await Promise.all([ownerContext.close(), receiverContext.close()])
})
