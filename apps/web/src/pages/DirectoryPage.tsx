import { PlaceholderScreen } from './PlaceholderScreen.tsx'

/**
 * Placeholder for the directory (spec 08 §3), which is also where the resolver
 * sends a miss with `?keyword=` and `?namespace=` pre-filled (spec 04 §8).
 */
export function DirectoryPage() {
  return (
    <PlaceholderScreen
      title="Directory"
      description="The organization's links, search, and link creation will live here."
    />
  )
}
