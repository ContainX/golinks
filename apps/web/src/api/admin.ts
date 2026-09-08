/**
 * The administration endpoints (spec 05 §3): members, the organization's
 * settings document (spec 06 §2), and the audit trail (spec 07).
 *
 * Every one of these requires the admin role. A member without it is answered
 * `forbidden`, which reaches the caller as an {@link ApiError} like any other.
 */

import type {
  AdminEventsQuery,
  AdminSettingsPutBody,
  AdminSettingsResponse,
  AdminUser,
  AdminUserListResponse,
  AdminUserPatchBody,
  AdminUsersQuery,
  AuditEventListResponse,
} from '@golinks/shared/api'
import {
  AdminEventsQuerySchema,
  AdminSettingsPutBodySchema,
  AdminSettingsResponseSchema,
  AdminUserListResponseSchema,
  AdminUserPatchBodySchema,
  AdminUserSchema,
  AdminUsersQuerySchema,
  AuditEventListResponseSchema,
} from '@golinks/shared/api'
import { apiFetch } from './http.ts'
import type { RequestOptions } from './resource.ts'
import { buildQuery, parseRequestBody, parseResponse, requestInit } from './resource.ts'

const USERS_PATH = '/admin/users'
const SETTINGS_PATH = '/admin/settings'
const EVENTS_PATH = '/admin/events'

function userPath(id: string): string {
  return `${USERS_PATH}/${encodeURIComponent(id)}`
}

/** `GET /admin/users` parameters. */
export type AdminUsersParams = Partial<AdminUsersQuery>

/** `GET /admin/events` parameters. */
export type AdminEventsParams = Partial<AdminEventsQuery>

/** `GET /admin/users`: one page of the organization's members. */
export async function listUsers(
  params: AdminUsersParams = {},
  options: RequestOptions = {},
): Promise<AdminUserListResponse> {
  const query = buildQuery(AdminUsersQuerySchema, params, 'GET /admin/users')
  const body = await apiFetch(`${USERS_PATH}${query}`, requestInit(options))
  return parseResponse(AdminUserListResponseSchema, body, 'user list')
}

/** `GET /admin/users/:id`. */
export async function getUser(id: string, options: RequestOptions = {}): Promise<AdminUser> {
  const body = await apiFetch(userPath(id), requestInit(options))
  return parseResponse(AdminUserSchema, body, 'User')
}

/**
 * `PATCH /admin/users/:id`: enables, disables, or re-roles a member. Changing
 * the role fixes it as `manual`; an admin acting on themselves is refused with
 * `cannot_modify_self`.
 */
export async function patchUser(
  id: string,
  body: AdminUserPatchBody,
  options: RequestOptions = {},
): Promise<AdminUser> {
  const json = parseRequestBody(AdminUserPatchBodySchema, body, 'PATCH /admin/users/:id')
  const result = await apiFetch(userPath(id), requestInit(options, { method: 'PATCH', json }))
  return parseResponse(AdminUserSchema, result, 'User')
}

/** `GET /admin/settings`: the whole settings document, defaults filled in. */
export async function getSettings(options: RequestOptions = {}): Promise<AdminSettingsResponse> {
  const body = await apiFetch(SETTINGS_PATH, requestInit(options))
  return parseResponse(AdminSettingsResponseSchema, body, 'organization settings')
}

/**
 * `PUT /admin/settings`: replaces the document.
 *
 * An omitted field takes its default rather than keeping its previous value, so
 * callers send back what `GET` gave them, changed.
 */
export async function putSettings(
  settings: AdminSettingsPutBody,
  options: RequestOptions = {},
): Promise<AdminSettingsResponse> {
  const json = parseRequestBody(AdminSettingsPutBodySchema, settings, 'PUT /admin/settings')
  const result = await apiFetch(SETTINGS_PATH, requestInit(options, { method: 'PUT', json }))
  return parseResponse(AdminSettingsResponseSchema, result, 'organization settings')
}

/** `GET /admin/events`: one page of the audit trail, newest first (spec 07). */
export async function listEvents(
  params: AdminEventsParams = {},
  options: RequestOptions = {},
): Promise<AuditEventListResponse> {
  const query = buildQuery(AdminEventsQuerySchema, params, 'GET /admin/events')
  const body = await apiFetch(`${EVENTS_PATH}${query}`, requestInit(options))
  return parseResponse(AuditEventListResponseSchema, body, 'audit event list')
}
