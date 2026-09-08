// The advisory lock that serializes keyword writes (spec 03 §6.1).
//
// Conflict detection reads before it writes, so two requests creating the same keyword at
// the same moment could both find nothing in the way. A transaction-scoped advisory lock on
// `(organization_id, namespace, keyword_prefix)` puts them in a queue instead: the second
// request waits, then runs its checks against the first one's committed row. Postgres
// releases the lock when the transaction ends, whether it commits or rolls back, so there
// is nothing to clean up.
//
// The prefix, rather than the whole keyword, is the third part of the key because every
// check in spec 03 §6.1 compares keywords that share a first segment. That is the narrowest
// key that still covers a pattern or prefix-fallback collision.

import { sql } from 'drizzle-orm'
import type { Transaction } from '../audit/index.ts'
import type { Database } from '../db/client.ts'

/** The triple a keyword write is serialized on. */
export interface KeywordLockKey {
  organizationId: string
  namespace: string
  prefix: string
}

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const UNSIGNED_64_MASK = 0xffffffffffffffffn
const SIGNED_64_MIN = 0x8000000000000000n
const UNSIGNED_64_RANGE = 0x10000000000000000n

/** A separator none of the three parts can contain, so distinct triples cannot collide. */
const KEY_SEPARATOR = '/'

function fnv1a64(value: string): bigint {
  let hash = FNV_OFFSET_BASIS
  for (const byte of new TextEncoder().encode(value)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & UNSIGNED_64_MASK
  }
  return hash
}

/**
 * The lock key for a triple: a 64-bit FNV-1a hash, folded into the signed range Postgres
 * advisory locks take. Stable across processes and releases, because a lock is only useful
 * when every replica computes the same number for the same triple.
 */
export function keywordLockKey(key: KeywordLockKey): bigint {
  const hash = fnv1a64([key.organizationId, key.namespace, key.prefix].join(KEY_SEPARATOR))
  return hash >= SIGNED_64_MIN ? hash - UNSIGNED_64_RANGE : hash
}

/**
 * Runs `work` inside a transaction that holds the keyword lock for the triple. Requests
 * touching other prefixes are unaffected; requests touching this one wait their turn.
 */
export async function withKeywordLock<Result>(
  db: Database,
  key: KeywordLockKey,
  work: (tx: Transaction) => Promise<Result>,
): Promise<Result> {
  const lockKey = keywordLockKey(key).toString()
  return await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(cast(${lockKey} as bigint))`)
    return await work(tx)
  })
}
