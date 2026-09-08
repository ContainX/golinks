import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { BrandingProvider } from './BrandingProvider.tsx'

export interface AppProvidersProps {
  queryClient: QueryClient
  children: ReactNode
}

/**
 * Everything the tree needs before a route renders.
 *
 * The API cache comes first, because the theme is one of the things fetched
 * through it: {@link BrandingProvider} reads the organization's branding from
 * `/me` and builds the Material UI theme, the document title, and the favicon
 * from it (spec 08 §1). The Material UI baseline stylesheet follows the theme.
 */
export function AppProviders({ queryClient, children }: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>{children}</BrandingProvider>
    </QueryClientProvider>
  )
}
