import { Outlet } from 'react-router'

/**
 * Root layout for every client route.
 *
 * Deliberately empty apart from the outlet: the header, navigation, banner, and
 * account menu described in spec 08 §7 are part of the UX design step (spec 08
 * §9) and are added once that has happened.
 */
export function AppShell() {
  return <Outlet />
}
