import { Outlet } from 'react-router'
import { ShellFrame } from '../features/shell/ShellFrame.tsx'

/**
 * Root layout for every client route.
 *
 * The chrome — app bar, navigation, organization banner, account menu, and the
 * notice explaining how to make the short host resolve — is the same on every
 * screen, so it is rendered once here and the route fills in the middle
 * (ADR 0002 §5). That includes the sign-in page, which is reachable with no
 * session at all; the shell reads `/me` and shows only the title when there is
 * no member to show anything else about.
 */
export function AppShell() {
  return (
    <ShellFrame>
      <Outlet />
    </ShellFrame>
  )
}
