/**
 * The frame every administration screen renders inside (ADR 0002 §7).
 *
 * It answers three questions before a screen is shown: is the session known
 * yet, may this member administer the organization at all, and is there room to
 * show a dense table. What it deliberately does not do is draw chrome — the app
 * bar, the banner, and the account menu belong to the shell this renders inside
 * of.
 */

import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import { useTheme } from '@mui/material/styles'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import useMediaQuery from '@mui/material/useMediaQuery'
import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'
import { Link as RouterLink, useLocation } from 'react-router'
import { useMe } from '../../queries/me.ts'

/** The tabs, in the order ADR 0002 §7 lists them. */
export const ADMIN_TABS = [
  { value: 'users', label: 'Users', path: '/_/admin/users' },
  { value: 'settings', label: 'Settings', path: '/_/admin/settings' },
  { value: 'events', label: 'Events', path: '/_/admin/events' },
] as const

/** The path the admin area opens on when no tab was named. */
export const ADMIN_DEFAULT_PATH = ADMIN_TABS[0].path

/** Which tab a path is inside, or `false` when it is none of them. */
function activeTab(pathname: string): string | false {
  const tab = ADMIN_TABS.find(
    (candidate) => pathname === candidate.path || pathname.startsWith(`${candidate.path}/`),
  )
  return tab?.value ?? false
}

/**
 * Whether a frame is already drawn around this subtree.
 *
 * Each admin screen renders its own frame, because the route table gives the
 * three tabs paths of their own rather than nesting them inside `/_/admin`. If
 * they are ever nested, the outer frame is the one that counts and the inner
 * one steps aside, so neither arrangement draws two rows of tabs.
 */
const InsideAdminLayout = createContext(false)

export interface AdminLayoutProps {
  children?: ReactNode
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const theme = useTheme()
  const location = useLocation()
  const me = useMe()
  const alreadyFramed = useContext(InsideAdminLayout)
  // ADR 0002 §9: the admin screens are tables and long forms, and a phone-width
  // rendering of either would be a worse answer than saying so.
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'))

  if (alreadyFramed) {
    return <>{children}</>
  }

  return (
    <InsideAdminLayout value>
      <Box
        component="section"
        sx={{
          width: '100%',
          maxWidth: 1200,
          mx: 'auto',
          px: { xs: 2, md: 3 },
          py: 3,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {me.isPending ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress aria-label="Loading the session" />
          </Box>
        ) : null}

        {me.isError ? (
          <Alert severity="error">
            <AlertTitle>Administration could not be opened</AlertTitle>
            {me.error.message}
          </Alert>
        ) : null}

        {me.data && me.data.user.role !== 'admin' ? (
          <Alert severity="info">
            <AlertTitle>Admins only</AlertTitle>
            Administering {me.data.organization.id} is limited to its admins. Ask one of them if you
            need something changed.
          </Alert>
        ) : null}

        {me.data && me.data.user.role === 'admin' ? (
          <>
            <Tabs
              value={activeTab(location.pathname)}
              aria-label="Administration"
              sx={{ borderBottom: 1, borderColor: 'divider' }}
            >
              {ADMIN_TABS.map((tab) => (
                <Tab
                  key={tab.value}
                  value={tab.value}
                  label={tab.label}
                  component={RouterLink}
                  to={tab.path}
                />
              ))}
            </Tabs>
            {isNarrow ? (
              <Alert severity="info">
                <AlertTitle>Administration is desktop-only</AlertTitle>
                These screens are wide tables and long forms. Open them on a larger screen to change
                members, settings, or to read the audit trail.
              </Alert>
            ) : (
              children
            )}
          </>
        ) : null}
      </Box>
    </InsideAdminLayout>
  )
}
