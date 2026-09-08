/**
 * The account menu (ADR 0002 §5, spec 08 §7).
 *
 * Everything about the member that is not a place to go: who they are signed
 * in as, what the service lets them do, how the app should look, and the way
 * out. Places to go are navigation, and live in the app bar beside it.
 */

import type { MeUser } from '@golinks/shared/api'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import LightModeIcon from '@mui/icons-material/LightMode'
import LogoutIcon from '@mui/icons-material/Logout'
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import ListItemIcon from '@mui/material/ListItemIcon'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'
import { useId, useState } from 'react'
import { signOut } from '../../api/auth.ts'
import type { ColorSchemeControl, ColorSchemePreference } from './colorScheme.ts'
import { COLOR_SCHEME_PREFERENCES } from './colorScheme.ts'

const ROLE_LABELS = { admin: 'Admin', member: 'Member' } as const

const COLOR_SCHEME_LABELS: Record<ColorSchemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

const COLOR_SCHEME_ICONS: Record<ColorSchemePreference, ReactNode> = {
  system: <SettingsBrightnessIcon fontSize="small" />,
  light: <LightModeIcon fontSize="small" />,
  dark: <DarkModeIcon fontSize="small" />,
}

/** The first letters of the local part, which is all an avatar has room for. */
function initials(email: string): string {
  const local = email.split('@')[0] ?? email
  const parts = local.split(/[.\-_+]/).filter((part) => part.length > 0)
  const letters = parts.slice(0, 2).map((part) => part[0] ?? '')
  return (letters.join('') || email.slice(0, 2)).toUpperCase()
}

export interface UserMenuProps {
  user: MeUser
  organizationId: string
  colorScheme: ColorSchemeControl
}

export function UserMenu({ user, organizationId, colorScheme }: UserMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const menuId = useId()
  const schemeLabelId = useId()
  const isOpen = anchor !== null

  return (
    <>
      <Button
        color="inherit"
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-haspopup="menu"
        aria-controls={isOpen ? menuId : undefined}
        aria-expanded={isOpen}
        endIcon={<ExpandMoreIcon />}
        sx={{ textTransform: 'none', gap: 1, pl: 0.5 }}
      >
        <Avatar
          // Outlined rather than filled: the app bar is painted in the
          // organization's primary color, and a border in the bar's own text
          // color is legible whatever that color turns out to be.
          sx={{
            width: 32,
            height: 32,
            fontSize: 13,
            fontWeight: 500,
            bgcolor: 'transparent',
            color: 'inherit',
            border: '1px solid currentColor',
          }}
        >
          {initials(user.email)}
        </Avatar>
        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
          {user.email}
        </Box>
      </Button>

      <Menu
        id={menuId}
        anchorEl={anchor}
        open={isOpen}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ list: { sx: { minWidth: 280, pt: 0 } } }}
      >
        <Box sx={{ px: 2, pt: 2, pb: 1.5 }}>
          <Typography variant="subtitle2" noWrap>
            {user.email}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 0.75, alignItems: 'center' }}>
            <Chip
              size="small"
              label={ROLE_LABELS[user.role]}
              color={user.role === 'admin' ? 'primary' : 'default'}
            />
            <Typography variant="caption" color="text.secondary" noWrap>
              {organizationId}
            </Typography>
          </Stack>
        </Box>

        <Divider />

        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography
            id={schemeLabelId}
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mb: 0.75 }}
          >
            Color scheme
          </Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            fullWidth
            value={colorScheme.preference}
            aria-labelledby={schemeLabelId}
            // Held while the choice is being written, so a second click cannot
            // race the first one to `PATCH /me`.
            disabled={colorScheme.isSaving}
            onChange={(_event, next: ColorSchemePreference | null) => {
              // A group with `exclusive` reports `null` when the active button
              // is pressed again; there is no "no scheme", so it stands.
              if (next !== null) {
                colorScheme.choose(next)
              }
            }}
          >
            {COLOR_SCHEME_PREFERENCES.map((value) => (
              <ToggleButton key={value} value={value} sx={{ gap: 0.75, textTransform: 'none' }}>
                {COLOR_SCHEME_ICONS[value]}
                {COLOR_SCHEME_LABELS[value]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>

        <Divider />

        <MenuItem
          onClick={() => {
            setAnchor(null)
            signOut()
          }}
        >
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          Sign out
        </MenuItem>
      </Menu>
    </>
  )
}
