import type { OrganizationSettings, OrganizationSettingsInput } from '../settings/index.ts'
import { OrganizationSettingsSchema } from '../settings/index.ts'

/** The admin settings endpoints (spec 05 section 3, spec 06 section 2). */

/** `GET /admin/settings` response: the organization settings document, fully populated. */
export const AdminSettingsResponseSchema = OrganizationSettingsSchema
export type AdminSettingsResponse = OrganizationSettings

/**
 * `PUT /admin/settings` body: the whole document. Omitted fields take their defaults rather than
 * keeping their previous value, so clients send back what `GET` gave them.
 */
export const AdminSettingsPutBodySchema = OrganizationSettingsSchema
export type AdminSettingsPutBody = OrganizationSettingsInput
