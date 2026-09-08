import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Placeholder root. Replaced by the application shell once the web scaffold lands.
const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <p>GoLinks</p>
    </StrictMode>,
  )
}
