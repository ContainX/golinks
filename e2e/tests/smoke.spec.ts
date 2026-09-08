// The scenarios of spec 10 §3 that need no designed screens: the sign-in gate, the session,
// creating and following a link, and organization isolation. Screen-level scenarios join
// once the UX design lands.

import { expect, test } from '@playwright/test'
import { baseURL } from '../playwright.config.ts'
import { createLink, ORGANIZATIONS, signIn, uniqueEmail, uniqueKeyword } from './support/sign-in.ts'

test('an anonymous keyword request is sent to sign in and returns to the keyword', async ({
  page,
}) => {
  const keyword = uniqueKeyword()
  await page.goto(`/${keyword}`)
  await expect(page).toHaveURL(/\/_\/(auth\/)?login/)
  expect(page.url()).toContain(encodeURIComponent(`/${keyword}`))
})

test('a member can sign in and read their profile', async ({ page }) => {
  const email = uniqueEmail(ORGANIZATIONS.widgets)
  await signIn(page, email)
  const me = await page.request.get('/_/api/v1/me')
  expect(me.status()).toBe(200)
  const body = (await me.json()) as { user: { email: string; organizationId: string } }
  expect(body.user.email).toBe(email)
  expect(body.user.organizationId).toBe(ORGANIZATIONS.widgets)
})

test('a member can create a link and follow it', async ({ page }) => {
  await signIn(page, uniqueEmail(ORGANIZATIONS.widgets))
  const keyword = uniqueKeyword()
  const destination = `${baseURL}/_/health/live`
  await createLink(page.request, { keyword, destination })

  await page.goto(`/${keyword}`)
  await expect(page).toHaveURL(destination)
})

test('a keyword nobody created lands on the directory with it pre-filled', async ({ page }) => {
  await signIn(page, uniqueEmail(ORGANIZATIONS.widgets))
  const keyword = uniqueKeyword()
  await page.goto(`/${keyword}`)
  await expect(page).toHaveURL(new RegExp(`/_/\\?keyword=${keyword}`))
})

test('a link is invisible to and unresolvable by another organization', async ({ browser }) => {
  const keyword = uniqueKeyword()

  const widgets = await browser.newContext()
  const widgetsPage = await widgets.newPage()
  await signIn(widgetsPage, uniqueEmail(ORGANIZATIONS.widgets))
  await createLink(widgetsPage.request, { keyword, destination: `${baseURL}/_/health/live` })
  await widgets.close()

  const gizmos = await browser.newContext()
  const gizmosPage = await gizmos.newPage()
  await signIn(gizmosPage, uniqueEmail(ORGANIZATIONS.gizmos))
  await gizmosPage.goto(`/${keyword}`)
  await expect(gizmosPage).toHaveURL(new RegExp(`/_/\\?keyword=${keyword}`))

  const list = await gizmosPage.request.get(`/_/api/v1/links?q=${keyword}`)
  expect(list.status()).toBe(200)
  const body = (await list.json()) as { items: { keyword: string }[] }
  expect(body.items.map((item) => item.keyword)).not.toContain(keyword)
  await gizmos.close()
})
