import { z } from 'zod'
import {
  ApiIdSchema,
  BooleanQuerySchema,
  CursorSchema,
  EmailSchema,
  ListLimitSchema,
  listEnvelopeSchema,
  TimestampSchema,
} from './common.ts'

/** User resources and the admin user endpoints (spec 05 sections 2.2 and 2.3, spec 01 section 2). */

/** Roles are scoped to one organization (spec 01 section 2.3). */
export const UserRoleSchema = z.enum(['member', 'admin'])
export type UserRole = z.infer<typeof UserRoleSchema>

/** Where the stored role came from. `manual` freezes it against sign-in recomputation. */
export const UserRoleSourceSchema = z.enum(['config', 'idp', 'manual'])
export type UserRoleSource = z.infer<typeof UserRoleSourceSchema>

/**
 * Preferences a member owns and edits through `PATCH /me` (spec 01 section 2.5).
 *
 * Keys are whitelisted: anything else is a `validation_failed`. Add a key here, and only here,
 * when the web app needs to remember something about a member.
 */
export const UserPreferencesSchema = z.strictObject({
  /** Ids of notices the member has closed, for example the short-host setup notice. */
  dismissedNotices: z.array(z.string().trim().min(1).max(100)).max(200).optional(),
  /** Which color scheme the app renders in; `system` follows the device preference. */
  colorScheme: z.enum(['system', 'light', 'dark']).optional(),
})
export type UserPreferences = z.infer<typeof UserPreferencesSchema>

/** The signed-in member as `GET /me` returns them. */
export const MeUserSchema = z.object({
  id: ApiIdSchema,
  email: EmailSchema,
  role: UserRoleSchema,
  organizationId: ApiIdSchema,
  preferences: UserPreferencesSchema,
  createdAt: TimestampSchema,
})
export type MeUser = z.infer<typeof MeUserSchema>

/** A member as the admin console sees them (spec 05 section 2.3). */
export const AdminUserSchema = z.object({
  id: ApiIdSchema,
  email: EmailSchema,
  role: UserRoleSchema,
  roleSource: UserRoleSourceSchema,
  isEnabled: z.boolean(),
  linkCount: z.number().int().min(0),
  lastLoginAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
})
export type AdminUser = z.infer<typeof AdminUserSchema>

/** `GET /admin/users` query parameters. */
export const AdminUsersQuerySchema = z.strictObject({
  /** Substring match against the email address. */
  q: z.string().trim().max(200).optional(),
  role: UserRoleSchema.optional(),
  enabled: BooleanQuerySchema.optional(),
  limit: ListLimitSchema,
  cursor: CursorSchema.optional(),
})
export type AdminUsersQuery = z.infer<typeof AdminUsersQuerySchema>

/**
 * `PATCH /admin/users/:id` body: a non-empty subset of `{ isEnabled, role }`.
 * Changing `role` sets `roleSource` to `manual`; an admin acting on themselves is
 * `cannot_modify_self`.
 */
export const AdminUserPatchBodySchema = z
  .strictObject({
    isEnabled: z.boolean().optional(),
    role: UserRoleSchema.optional(),
  })
  .refine(
    (body) => body.isEnabled !== undefined || body.role !== undefined,
    'Provide at least one field to change.',
  )
export type AdminUserPatchBody = z.infer<typeof AdminUserPatchBodySchema>

/** `:id` on every `/admin/users/:id` route. */
export const UserIdParamsSchema = z.strictObject({ id: ApiIdSchema })
export type UserIdParams = z.infer<typeof UserIdParamsSchema>

/** `GET /admin/users` response. */
export const AdminUserListResponseSchema = listEnvelopeSchema(AdminUserSchema)
export type AdminUserListResponse = z.infer<typeof AdminUserListResponseSchema>
