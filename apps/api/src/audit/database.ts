// The handles a write runs on.
//
// A change and its audit row must land together (spec 07 §1), so every write function
// takes the handle it should run on rather than reaching for the process-wide one: the
// pool when a single statement is the whole change, an open transaction when several
// statements share a fate. The alias lives with the audit trail because that is the
// module every other write module builds on.

import type { Database } from '../db/client.ts'

/** An open Drizzle transaction, as `db.transaction()` hands it to its callback. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/** Either the pool handle or an open transaction. */
export type DatabaseExecutor = Database | Transaction
