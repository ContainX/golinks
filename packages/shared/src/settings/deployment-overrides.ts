import { z } from 'zod'
import {
  AdminEmailSchema,
  AdminSuppliedUrlSchema,
  BrandingTitleSchema,
  DEFAULT_ORGANIZATION_SETTINGS,
  formatFieldPath,
  HexColorSchema,
  KeywordAllowedPatternSchema,
  LinkEditModeSchema,
  MAX_ADMINS,
  MAX_NAVIGATION_LINKS,
  OrganizationBannerSchema,
  OrganizationNavigationLinkSchema,
  type OrganizationSettings,
  OrganizationSettingsSchema,
  type OrganizationSettingsValidationError,
  parseOrganizationSettings,
} from './organization-settings.ts'

/**
 * Settings a deployment fixes for every organization (spec 06 section 6).
 *
 * A deployment hands the service a partial settings document, from a file or an environment
 * variable, and its values win over whatever each organization has stored. Admins see those
 * fields as managed: the effective value is reported, and a write that changes one is rejected.
 *
 * Only the fields whose change leaves stored links untouched can be fixed this way. The default
 * namespace, the namespace list, punctuation sensitivity, and the resolution mode each rewrite or
 * revalidate keywords when they change (spec 06 section 2), which has to happen inside the
 * transaction that stores them; those are set through the admin API or the settings import
 * command, never from the outside.
 */

const optionalColor = HexColorSchema.nullable().optional()

/** The colors of one scheme, every one of them optional. */
const SchemeColorsOverridesSchema = z.strictObject({
  primaryColor: optionalColor,
  secondaryColor: optionalColor,
  backgroundColor: optionalColor,
  surfaceColor: optionalColor,
})

/** The branding fields, every one of them optional. */
const BrandingOverridesSchema = z.strictObject({
  title: BrandingTitleSchema.optional(),
  logoUrl: AdminSuppliedUrlSchema.nullable().optional(),
  faviconUrl: AdminSuppliedUrlSchema.nullable().optional(),
  primaryColor: optionalColor,
  secondaryColor: optionalColor,
  light: SchemeColorsOverridesSchema.optional(),
  dark: SchemeColorsOverridesSchema.optional(),
})

/** The one keyword rule that applies to new keywords only (spec 06 section 2). */
const KeywordOverridesSchema = z.strictObject({
  allowedPattern: KeywordAllowedPatternSchema.optional(),
})

/**
 * The document a deployment may supply. Unknown keys are rejected, so a field the deployment is
 * not allowed to fix is reported at startup rather than quietly ignored.
 */
export const DeploymentSettingsOverridesSchema = z.strictObject({
  editMode: LinkEditModeSchema.optional(),
  readOnly: z.boolean().optional(),
  admins: z.array(AdminEmailSchema).max(MAX_ADMINS).optional(),
  banner: OrganizationBannerSchema.nullable().optional(),
  branding: BrandingOverridesSchema.optional(),
  navigationLinks: z.array(OrganizationNavigationLinkSchema).max(MAX_NAVIGATION_LINKS).optional(),
  keywords: KeywordOverridesSchema.optional(),
})

export type DeploymentSettingsOverrides = z.infer<typeof DeploymentSettingsOverridesSchema>

/** An overrides document that fixes nothing. */
export const NO_DEPLOYMENT_OVERRIDES: DeploymentSettingsOverrides = Object.freeze({})

export type ParseDeploymentSettingsOverridesResult =
  | { readonly ok: true; readonly overrides: DeploymentSettingsOverrides }
  | { readonly ok: false; readonly error: OrganizationSettingsValidationError }

/** Why each of the settings that cannot be fixed from outside is excluded. */
const LINK_REWRITING_FIELDS: Readonly<Record<string, string>> = {
  defaultNamespace: 'renames the namespace of every link',
  namespaces: 'is checked against existing links',
  'keywords.punctuationSensitive': 'recomputes the canonical keyword of every link',
  'keywords.resolutionMode': 'is checked against existing keywords',
}

function unknownFieldMessage(field: string): string {
  const reason = LINK_REWRITING_FIELDS[field]
  if (reason === undefined) return 'Unknown field.'
  return `"${field}" cannot be fixed by the deployment because changing it ${reason}. Set it through the admin API or "golinks settings import".`
}

function collectIssues(issues: ReadonlyArray<z.core.$ZodIssue>, fields: Record<string, string>) {
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        const field = formatFieldPath([...issue.path, key])
        fields[field] ??= unknownFieldMessage(field)
      }
      continue
    }
    const field = formatFieldPath(issue.path)
    fields[field] ??= issue.message
  }
}

/**
 * Validates a deployment's overrides document, on its own and as applied to the default
 * settings, so that a document which could never produce valid settings is refused at startup.
 */
export function parseDeploymentSettingsOverrides(
  input: unknown,
): ParseDeploymentSettingsOverridesResult {
  const fields: Record<string, string> = {}
  const parsed = DeploymentSettingsOverridesSchema.safeParse(input)
  if (!parsed.success) {
    collectIssues(parsed.error.issues, fields)
  } else {
    const applied = parseOrganizationSettings(
      mergeDefined(DEFAULT_ORGANIZATION_SETTINGS, parsed.data, ''),
    )
    if (applied.ok) return { ok: true, overrides: parsed.data }
    Object.assign(fields, applied.error.fields)
  }
  return {
    ok: false,
    error: {
      code: 'validation_failed',
      message: 'The deployment settings overrides are not valid.',
      fields,
    },
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Settings fields that are objects but change as a unit: an override replaces the whole
 * value rather than merging into it, and the field is reported as one managed path.
 */
const REPLACED_AS_A_WHOLE = new Set(['banner'])

function mergeDefined(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...target }
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    const current = merged[key]
    const fieldPath = path === '' ? key : `${path}.${key}`
    merged[key] =
      isPlainObject(value) && isPlainObject(current) && !REPLACED_AS_A_WHOLE.has(fieldPath)
        ? mergeDefined(current, value, fieldPath)
        : value
  }
  return merged
}

/** The organization's settings with the deployment's values laid over them. */
export function applyDeploymentSettingsOverrides(
  settings: OrganizationSettings,
  overrides: DeploymentSettingsOverrides,
): OrganizationSettings {
  return OrganizationSettingsSchema.parse(mergeDefined(settings, overrides, ''))
}

function collectPaths(value: Record<string, unknown>, path: string, paths: string[]): void {
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) continue
    const fieldPath = path === '' ? key : `${path}.${key}`
    if (isPlainObject(child) && !REPLACED_AS_A_WHOLE.has(fieldPath)) {
      collectPaths(child, fieldPath, paths)
    } else {
      paths.push(fieldPath)
    }
  }
}

/**
 * The dotted paths the deployment fixes (`branding.title`, `branding.dark.primaryColor`,
 * `admins`), sorted, for reporting to admins and for judging a write.
 */
export function managedSettingsPaths(overrides: DeploymentSettingsOverrides): string[] {
  const paths: string[] = []
  collectPaths(overrides, '', paths)
  return paths.sort()
}

/** The value at a dotted path of a settings document, or `undefined` off the document. */
export function settingsValueAt(document: unknown, path: string): unknown {
  let current: unknown = document
  for (const segment of path.split('.')) {
    if (!isPlainObject(current)) return undefined
    current = current[segment]
  }
  return current
}

function isEqualValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((item, index) => isEqualValue(item, right[index]))
    )
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    return [...keys].every((key) => isEqualValue(left[key], right[key]))
  }
  return false
}

/**
 * The managed paths a settings document tries to change, each with the message admins get
 * back. Empty when the document keeps every managed value as the deployment fixed it.
 */
export function managedSettingsViolations(
  document: OrganizationSettings,
  overrides: DeploymentSettingsOverrides,
): Record<string, string> {
  const violations: Record<string, string> = {}
  for (const path of managedSettingsPaths(overrides)) {
    if (!isEqualValue(settingsValueAt(document, path), settingsValueAt(overrides, path))) {
      violations[path] = 'This setting is fixed by the deployment and cannot be changed here.'
    }
  }
  return violations
}
