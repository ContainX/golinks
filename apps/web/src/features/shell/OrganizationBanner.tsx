/**
 * The organization's banner (spec 06 §2, ADR 0002 §5).
 *
 * An admin writes it, every member sees it, and it says something about the
 * whole deployment — a migration on Friday, a policy about who may create
 * links — so it sits directly under the app bar, full width, above whatever
 * screen is open. There is nothing to dismiss: it is there until an admin
 * clears it.
 */

import type { OrganizationBanner } from '@golinks/shared/settings'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'

export interface OrganizationBannerAlertProps {
  banner: OrganizationBanner
}

export function OrganizationBannerAlert({ banner }: OrganizationBannerAlertProps) {
  return (
    <Alert
      severity={banner.level}
      // Square, edge to edge: it belongs to the window rather than to the page.
      sx={{ borderRadius: 0, alignItems: 'center' }}
      action={
        banner.url === null ? undefined : (
          <Button color="inherit" size="small" href={banner.url} target="_blank" rel="noreferrer">
            Learn more
          </Button>
        )
      }
    >
      {banner.text}
    </Alert>
  )
}
