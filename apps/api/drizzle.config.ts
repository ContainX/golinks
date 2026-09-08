// Drizzle Kit generates the SQL migration files in ./drizzle from ./src/db/schema.
//
//   pnpm --filter @golinks/api exec drizzle-kit generate
//
// Generation reads the schema only; it never touches a database. The credentials below are
// used by the commands that do connect (studio, push, pull), which the project does not use
// as part of its normal workflow: migrations are checked-in SQL (spec 09 section 3).

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  // Columns are named explicitly in the schema; this is the fallback for any added later.
  casing: 'snake_case',
  breakpoints: true,
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://golinks:golinks@localhost:5432/golinks',
  },
})
