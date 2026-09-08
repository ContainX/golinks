import { z } from 'zod'
import {
  KeywordRulesSchema,
  LinkEditModeSchema,
  NamespaceNameSchema,
  OrganizationBannerSchema,
  OrganizationBrandingSchema,
  OrganizationNavigationLinkSchema,
} from '../settings/index.ts'
import { ApiIdSchema } from './common.ts'
import { MeUserSchema, UserPreferencesSchema } from './users.ts'

/** `GET /me` and `PATCH /me` (spec 05 section 2.2). */

/** Deployment facts the web app needs to render itself. */
export const AppInfoSchema = z.object({
  /** Canonical origin, for example `https://links.example.com`. */
  baseUrl: z.url(),
  /** Hostname members type, shown in setup help and the OpenSearch descriptor. */
  shortHost: z.string().min(1),
  version: z.string().min(1),
})
export type AppInfo = z.infer<typeof AppInfoSchema>

/**
 * The caller's organization: its id plus the settings every member may see.
 *
 * The `admins` list from the settings document is deliberately absent; it is an admin-only field
 * served by `GET /admin/settings`.
 */
export const MeOrganizationSchema = z.object({
  id: ApiIdSchema,
  defaultNamespace: NamespaceNameSchema,
  namespaces: z.array(NamespaceNameSchema),
  keywords: KeywordRulesSchema,
  editMode: LinkEditModeSchema,
  readOnly: z.boolean(),
  banner: OrganizationBannerSchema.nullable(),
  branding: OrganizationBrandingSchema,
  navigationLinks: z.array(OrganizationNavigationLinkSchema),
})
export type MeOrganization = z.infer<typeof MeOrganizationSchema>

/** `GET /me` and `PATCH /me` response. */
export const MeSchema = z.object({
  user: MeUserSchema,
  organization: MeOrganizationSchema,
  app: AppInfoSchema,
})
export type Me = z.infer<typeof MeSchema>

/** `PATCH /me` body. Only whitelisted preference keys are accepted. */
export const MePatchBodySchema = z.strictObject({
  preferences: UserPreferencesSchema,
})
export type MePatchBody = z.infer<typeof MePatchBodySchema>
