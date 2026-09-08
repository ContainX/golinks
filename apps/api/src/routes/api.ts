// Composes the JSON API under /_/api/v1 (spec 05). Each module registers its own routes;
// this file only fixes the order and gives the app factory one thing to call.

import type { GoLinksApp } from '../types.ts'
import { registerAdminRoutes } from './admin.ts'
import { registerLinkRoutes } from './links.ts'
import { registerTransferRoutes } from './transfers.ts'

export const API_PREFIX = '/_/api/v1'

export function registerApiRoutes(app: GoLinksApp): void {
  registerLinkRoutes(app)
  registerTransferRoutes(app)
  registerAdminRoutes(app)
}
