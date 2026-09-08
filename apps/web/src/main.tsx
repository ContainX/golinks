import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { AppProviders } from './app/AppProviders.tsx'
import { createQueryClient } from './app/queryClient.ts'
import { createAppRouter } from './app/router.ts'

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
