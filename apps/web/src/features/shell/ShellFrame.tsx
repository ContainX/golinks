/**
 * The chrome every screen sits inside (ADR 0002 §5).
 *
 * One read of `/me` supplies all of it: who is signed in, what the
 * organization has configured, and what the deployment calls itself
 * (spec 05 §2.2). It is read here and handed down as props, so that the pieces
 * of the shell are ordinary components that can be rendered with any member.
 *
 * The order down the page is the order of authority. The app bar says where
 * you are and who you are. The organization's banner comes next, because an
 * admin put it there for everyone. The short-host notice follows, addressed to
 * this member alone and closed for good once they have read it. Then the
 * screen.
 */

import { DEFAULT_BRANDING_TITLE } from '@golinks/shared/settings'
import Box from '@mui/material/Box'
import Container from '@mui/material/Container'
import type { ReactNode } from 'react'
import { useBranding } from '../../app/BrandingProvider.tsx'
import { useMe } from '../../queries/me.ts'
import { useColorSchemePreference } from './colorScheme.ts'
import { SHORT_HOST_NOTICE_ID, useDismissedNotices } from './notices.ts'
import { OrganizationBannerAlert } from './OrganizationBanner.tsx'
import { ShellAppBar } from './ShellAppBar.tsx'
import { ShortHostNotice } from './ShortHostNotice.tsx'

export interface ShellFrameProps {
  children: ReactNode
}

export function ShellFrame({ children }: ShellFrameProps) {
  const { data } = useMe()
  const branding = useBranding()
  // Called here, once, high enough that the member's stored scheme applies to
  // every screen rather than only to the one that happens to show the control.
  const colorScheme = useColorSchemePreference()
  const notices = useDismissedNotices()

  const me = data ?? null
  const banner = me?.organization.banner ?? null
  const showShortHostNotice = me !== null && !notices.isDismissed(SHORT_HOST_NOTICE_ID)

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
      }}
    >
      <ShellAppBar
        title={branding?.title ?? DEFAULT_BRANDING_TITLE}
        logoUrl={branding?.logoUrl ?? null}
        me={me}
        colorScheme={colorScheme}
      />
      {banner === null ? null : <OrganizationBannerAlert banner={banner} />}
      <Container component="main" maxWidth="lg" sx={{ py: 3, flexGrow: 1 }}>
        {showShortHostNotice && me !== null ? (
          <ShortHostNotice app={me.app} onDismiss={() => notices.dismiss(SHORT_HOST_NOTICE_ID)} />
        ) : null}
        {children}
      </Container>
    </Box>
  )
}
