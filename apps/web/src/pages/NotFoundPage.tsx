import { PlaceholderScreen } from './PlaceholderScreen.tsx'

/**
 * Reached only for an unknown path under `/_/`. Every path outside `/` and
 * `/_/` belongs to the resolver and never reaches the client router at all
 * (spec 04 §1).
 */
export function NotFoundPage() {
  return (
    <PlaceholderScreen
      title="Page not found"
      description="No application page answers to this address."
    />
  )
}
