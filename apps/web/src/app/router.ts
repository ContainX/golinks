import type { RouterProviderProps } from 'react-router'
import { createBrowserRouter } from 'react-router'
import { appRoutes } from './routes.tsx'

/**
 * Builds the browser router over {@link appRoutes}.
 *
 * The app is served from the domain root, so there is no basename: `/` is the
 * directory and `/_/` prefixes every other screen (spec 04 §1).
 */
export function createAppRouter(): RouterProviderProps['router'] {
  return createBrowserRouter(appRoutes)
}
