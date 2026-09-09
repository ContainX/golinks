import { z } from 'zod'

/**
 * The organization settings document (spec 06 section 2).
 *
 * One JSON document per organization, stored in `organizations.settings` and edited by admins.
 * Every field carries a default, so an empty document `{}` parses into a fully populated one.
 */

/** Namespace names are lowercase letters, digits, and hyphens. */
export const NAMESPACE_NAME_PATTERN = /^[a-z0-9-]+$/

/** Longest accepted namespace name. */
export const NAMESPACE_NAME_MAX_LENGTH = 30

/** The keyword pattern every organization starts with (spec 03 section 2.3). */
export const DEFAULT_KEYWORD_ALLOWED_PATTERN = '^[a-z0-9-]+(/([a-z0-9-]+|%s))*$'

/** The namespace an organization uses until an admin changes it. */
export const DEFAULT_NAMESPACE = 'go'

/** The header and page title shown before an admin sets one. */
export const DEFAULT_BRANDING_TITLE = 'GoLinks'

const MAX_NAMESPACES = 50
export const MAX_ADMINS = 500
export const MAX_NAVIGATION_LINKS = 20
const MAX_URL_LENGTH = 2048

/** `#rrggbb`, matched after the value has been lowercased. */
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/

const absoluteHttpUrl = z.url({ protocol: /^https?$/ })

/**
 * A link target an admin may put in front of members: either an absolute `http`/`https` URL or a
 * path rooted at this service. Protocol-relative values (`//host`) and every other scheme are
 * rejected so that settings cannot be used to inject `javascript:` targets into the web app.
 */
export const AdminSuppliedUrlSchema = z
  .string()
  .trim()
  .min(1, 'A URL is required.')
  .max(MAX_URL_LENGTH)
  .refine(
    (value) =>
      value.startsWith('/') ? !value.startsWith('//') : absoluteHttpUrl.safeParse(value).success,
    'Must be an http(s) URL or a path beginning with "/".',
  )

/** One namespace name: 1-30 characters of `[a-z0-9-]`. */
export const NamespaceNameSchema = z
  .string()
  .trim()
  .min(1, 'A namespace name is required.')
  .max(
    NAMESPACE_NAME_MAX_LENGTH,
    `A namespace name may be at most ${NAMESPACE_NAME_MAX_LENGTH} characters.`,
  )
  .regex(
    NAMESPACE_NAME_PATTERN,
    'A namespace name may contain only lowercase letters, digits, and hyphens.',
  )

export type NamespaceName = z.infer<typeof NamespaceNameSchema>

/** How a keyword that is not an exact match is resolved (spec 04 section 5). */
export const KeywordResolutionModeSchema = z.enum(['standard', 'prefixFallback'])
export type KeywordResolutionMode = z.infer<typeof KeywordResolutionModeSchema>

/**
 * The organization's keyword rules.
 *
 * `allowedPattern` must compile as a regular expression; the invariants in spec 03 section 2.3
 * hold whatever the pattern says.
 */
export const KeywordAllowedPatternSchema = z
  .string()
  .trim()
  .min(1, 'An allowed pattern is required.')
  .max(1000)
  .refine((pattern) => {
    try {
      new RegExp(pattern)
      return true
    } catch {
      return false
    }
  }, 'The allowed pattern must be a valid regular expression.')

export const KeywordRulesSchema = z.strictObject({
  allowedPattern: KeywordAllowedPatternSchema.default(DEFAULT_KEYWORD_ALLOWED_PATTERN),
  punctuationSensitive: z.boolean().default(true),
  resolutionMode: KeywordResolutionModeSchema.default('standard'),
})

/**
 * The keyword rules an organization applies. Keyword normalization, canonicalization, and
 * validation read exactly these three fields.
 */
export type KeywordRules = z.infer<typeof KeywordRulesSchema>

/** Who may edit a link's destination (spec 03 section 5). */
export const LinkEditModeSchema = z.enum(['ownersAndAdmins', 'anyMember'])
export type LinkEditMode = z.infer<typeof LinkEditModeSchema>

/** Prominence of the organization-wide banner. */
export const BannerLevelSchema = z.enum(['info', 'warning'])
export type BannerLevel = z.infer<typeof BannerLevelSchema>

/** The banner shown to every member, or `null` to hide it. */
export const OrganizationBannerSchema = z.strictObject({
  text: z.string().trim().min(1, 'Banner text is required.').max(500),
  url: AdminSuppliedUrlSchema.nullable().default(null),
  level: BannerLevelSchema.default('info'),
})

export type OrganizationBanner = z.infer<typeof OrganizationBannerSchema>

/** One `#rrggbb` color, lowercased. */
export const HexColorSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HEX_COLOR_PATTERN, 'A color must be written as #rrggbb.')

/** A branding color, or `null` for the app's own default. */
const BrandingColorSchema = HexColorSchema.nullable().default(null)

/** The header and page title. */
export const BrandingTitleSchema = z.string().trim().min(1, 'A title is required.').max(120)

/**
 * The colors of one color scheme, light or dark. Every one of them is optional: a scheme
 * without a value falls back to the scheme-independent brand colors, and past those to the
 * app's own palette.
 */
export const BrandingSchemeColorsSchema = z.strictObject({
  /** The brand color for actions and the active state. */
  primaryColor: BrandingColorSchema,
  secondaryColor: BrandingColorSchema,
  /** The page ground. */
  backgroundColor: BrandingColorSchema,
  /** The surface cards, tables, and dialogs sit on. */
  surfaceColor: BrandingColorSchema,
})

export type BrandingSchemeColors = z.infer<typeof BrandingSchemeColorsSchema>

/**
 * Title, logo, and colors applied to the web app.
 *
 * `primaryColor` and `secondaryColor` apply to both color schemes; the dark scheme lightens
 * them until they read on a dark surface. `light` and `dark` fine-tune one scheme at a time
 * and win over the shared pair.
 */
export const OrganizationBrandingSchema = z.strictObject({
  title: BrandingTitleSchema.default(DEFAULT_BRANDING_TITLE),
  logoUrl: AdminSuppliedUrlSchema.nullable().default(null),
  faviconUrl: AdminSuppliedUrlSchema.nullable().default(null),
  primaryColor: BrandingColorSchema,
  secondaryColor: BrandingColorSchema,
  light: BrandingSchemeColorsSchema.prefault({}),
  dark: BrandingSchemeColorsSchema.prefault({}),
})

export type OrganizationBranding = z.infer<typeof OrganizationBrandingSchema>

/** One entry in the header and menu. */
export const OrganizationNavigationLinkSchema = z.strictObject({
  text: z.string().trim().min(1, 'Link text is required.').max(60),
  url: AdminSuppliedUrlSchema,
  adminOnly: z.boolean().default(false),
})

export type OrganizationNavigationLink = z.infer<typeof OrganizationNavigationLinkSchema>

/** An email that receives the admin role at sign-in (spec 01 section 2.3). */
export const AdminEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Admins must be email addresses.'))

/**
 * The whole settings document.
 *
 * Unknown keys are rejected rather than dropped, so a misspelled field in `PUT /admin/settings`
 * is reported back instead of silently ignored.
 */
export const OrganizationSettingsSchema = z
  .strictObject({
    defaultNamespace: NamespaceNameSchema.default(DEFAULT_NAMESPACE),
    namespaces: z.array(NamespaceNameSchema).max(MAX_NAMESPACES).default([]),
    keywords: KeywordRulesSchema.prefault({}),
    editMode: LinkEditModeSchema.default('ownersAndAdmins'),
    readOnly: z.boolean().default(false),
    admins: z.array(AdminEmailSchema).max(MAX_ADMINS).default([]),
    banner: OrganizationBannerSchema.nullable().default(null),
    branding: OrganizationBrandingSchema.prefault({}),
    navigationLinks: z
      .array(OrganizationNavigationLinkSchema)
      .max(MAX_NAVIGATION_LINKS)
      .default([]),
  })
  .superRefine((settings, ctx) => {
    const seen = new Set<string>()
    settings.namespaces.forEach((namespace, index) => {
      if (namespace === settings.defaultNamespace) {
        ctx.addIssue({
          code: 'custom',
          path: ['namespaces', index],
          message: `"${namespace}" is already the default namespace.`,
        })
        return
      }
      if (seen.has(namespace)) {
        ctx.addIssue({
          code: 'custom',
          path: ['namespaces', index],
          message: `"${namespace}" is listed more than once.`,
        })
        return
      }
      seen.add(namespace)
    })

    const seenAdmins = new Set<string>()
    settings.admins.forEach((email, index) => {
      if (seenAdmins.has(email)) {
        ctx.addIssue({
          code: 'custom',
          path: ['admins', index],
          message: `"${email}" is listed more than once.`,
        })
        return
      }
      seenAdmins.add(email)
    })
  })

/** A validated organization settings document with every field populated. */
export type OrganizationSettings = z.infer<typeof OrganizationSettingsSchema>

/** The shape an admin may send; every field is optional because every field has a default. */
export type OrganizationSettingsInput = z.input<typeof OrganizationSettingsSchema>

/** The document a brand-new organization starts with. */
export const DEFAULT_ORGANIZATION_SETTINGS: OrganizationSettings = Object.freeze(
  OrganizationSettingsSchema.parse({}),
)

/** A field-keyed report of everything wrong with a rejected settings document. */
export interface OrganizationSettingsValidationError {
  readonly code: 'validation_failed'
  readonly message: string
  /** Dotted field path (`branding.primaryColor`, `namespaces[1]`) to the first message for it. */
  readonly fields: Record<string, string>
}

export type ParseOrganizationSettingsResult =
  | { readonly ok: true; readonly settings: OrganizationSettings }
  | { readonly ok: false; readonly error: OrganizationSettingsValidationError }

/** The key used for problems that belong to the document as a whole. */
const ROOT_FIELD = 'settings'

export function formatFieldPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return ROOT_FIELD
  let formatted = ''
  for (const segment of path) {
    if (typeof segment === 'number') {
      formatted += `[${segment}]`
    } else if (formatted === '') {
      formatted = String(segment)
    } else {
      formatted += `.${String(segment)}`
    }
  }
  return formatted === '' ? ROOT_FIELD : formatted
}

/**
 * Validate an untrusted settings document, filling in defaults.
 *
 * Returns the populated document, or a structured error whose `fields` can be sent straight back
 * as the `details` of a `validation_failed` response (spec 05 section 4).
 */
export function parseOrganizationSettings(input: unknown): ParseOrganizationSettingsResult {
  const result = OrganizationSettingsSchema.safeParse(input)
  if (result.success) {
    return { ok: true, settings: result.data }
  }

  const fields: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const field = formatFieldPath(issue.path)
    if (!(field in fields)) {
      fields[field] = issue.message
    }
  }

  return {
    ok: false,
    error: {
      code: 'validation_failed',
      message: 'The organization settings document is not valid.',
      fields,
    },
  }
}
