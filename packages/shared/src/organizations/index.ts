// Organization resolution from a verified email address (spec 01 §1.2).

export { CONSUMER_EMAIL_DOMAINS, isConsumerEmailDomain } from './consumer-domains.ts'
export {
  extractEmailDomain,
  type OrganizationResolutionConfig,
  type OrganizationResolutionErrorCode,
  type OrganizationResolutionFailure,
  type OrganizationResolutionResult,
  type OrganizationResolutionStrategy,
  type ResolvedOrganization,
  resolveOrganizationId,
} from './resolution.ts'
