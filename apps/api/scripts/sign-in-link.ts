// Prints a link that signs a browser in through the test sign-in endpoint (spec 02 §8), for
// trying the app locally without an identity provider. Reads AUTH_TEST_SECRET, BASE_URL, and
// AUTH_TEST_DOMAINS from the environment or the nearest .env.
//
//   pnpm --filter @golinks/api sign-in-link jane@widgets.test
//   pnpm --filter @golinks/api sign-in-link sam@widgets.test /handbook   # land on a keyword

import { SignJWT } from 'jose'
import { loadDotEnvIfPresent } from '../src/config/dotenv.ts'

loadDotEnvIfPresent()

const email = process.argv[2]
const redirectTo = process.argv[3] ?? '/'
const secret = process.env.AUTH_TEST_SECRET
const baseUrl = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
const domains = (process.env.AUTH_TEST_DOMAINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0)

if (email === undefined || !email.includes('@')) {
  process.stderr.write('Usage: sign-in-link <email> [redirectTo]\n')
  process.exit(64)
}
if (process.env.AUTH_TEST_MODE !== 'true' || secret === undefined) {
  process.stderr.write(
    'Test sign-in is off: set AUTH_TEST_MODE=true and AUTH_TEST_SECRET in .env.\n',
  )
  process.exit(78)
}
const domain = email.slice(email.indexOf('@') + 1)
if (!domains.includes(domain)) {
  process.stderr.write(
    `${domain} is not in AUTH_TEST_DOMAINS (${domains.join(', ') || 'empty'}).\n`,
  )
  process.exit(78)
}

const token = await new SignJWT({ email, groups: [] })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('4m')
  .sign(new TextEncoder().encode(secret))

const url = new URL('/_/auth/test-login', baseUrl)
url.searchParams.set('token', token)
url.searchParams.set('redirectTo', redirectTo)
process.stdout.write(`Open within 4 minutes:\n${url.toString()}\n`)
