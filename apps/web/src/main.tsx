import './branding/fonts.ts'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { AppProviders } from './app/AppProviders.tsx'
import { createQueryClient } from './app/queryClient.ts'
import { createAppRouter } from './app/router.ts'
import { initColorScheme } from './features/shell/initColorScheme.ts'

// Before anything is rendered: put the member's color scheme on the document,
// so the first paint is in the scheme they chose rather than in the other one
// (ADR 0002 §10).
initColorScheme()

const container = document.getElementById('root')
if (!container) {
  throw new Error('The document is missing the #root element the app mounts into.')
}

const queryClient = createQueryClient()
const router = createAppRouter()

createRoot(container).render(
  <StrictMode>
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
)
