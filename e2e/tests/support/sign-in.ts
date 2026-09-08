// Signs a browser context in through the test sign-in endpoint (spec 02 §8), which the
// instance under test must have enabled (AUTH_TEST_MODE=true with AUTH_TEST_SECRET and
// AUTH_TEST_DOMAINS, as .env.example and the compose full profile do).

import type { APIRequestContext, Page } from '@playwright/test'
import { SignJWT } from 'jose'
import { baseURL } from '../../playwright.config.ts'

export const TEST_SECRET = process.env.E2E_TEST_SECRET ?? 'development-only-test-sign-in-secret'
export const ORGANIZATIONS = { widgets: 'widgets.test', gizmos: 'gizmos.test' } as const

export function uniqueEmail(domain: string): string {
  return `member-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${domain}`
}

export function uniqueKeyword(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export async function mintTestToken(email: string, groups: string[] = []): Promise<string> {
  return new SignJWT({ email, groups })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('4m')
    .sign(new TextEncoder().encode(TEST_SECRET))
}

/** Signs the page's browser context in and lands on the directory. */
export async function signIn(page: Page, email: string, groups: string[] = []): Promise<void> {
  const token = await mintTestToken(email, groups)
  await page.goto(`/_/auth/test-login?token=${encodeURIComponent(token)}&redirectTo=%2F`)
}

/** Headers state-changing API calls need from a browser context (spec 02 §6). */
export function apiHeaders(): Record<string, string> {
  return { Origin: baseURL, 'Content-Type': 'application/json' }
}

export async function createLink(
  request: APIRequestContext,
  input: { keyword: string; destination: string; namespace?: string; isUnlisted?: boolean },
): Promise<{ id: string; fullPath: string }> {
  const response = await request.post('/_/api/v1/links', { data: input, headers: apiHeaders() })
  if (response.status() !== 201) {
    throw new Error(
      `Creating ${input.keyword} failed: ${response.status()} ${await response.text()}`,
    )
  }
  return (await response.json()) as { id: string; fullPath: string }
}
