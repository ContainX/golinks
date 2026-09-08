/**
 * The app bar (ADR 0002 §5).
 *
 * On the left, who this is: the organization's logo or a stand-in mark, the
 * product title it chose, and the organization's own id, so a member with
 * accounts in two deployments can tell them apart. Beside it, the sections
 * they may open. On the right, the account menu.
 *
 * On a narrow screen the sections move into a temporary drawer behind a menu
 * button (ADR 0002 §9). Which one is shown is decided in CSS rather than by
 * measuring the window, so the right one is on the page from the first paint.
 *
 * With no member — before `/me` has answered, and on the sign-in page, which
 * is reachable signed out — the bar is the title and nothing else. There is no
 * navigation to offer someone who has not been identified yet, and no account
 * to show.
 */

import type { Me } from '@golinks/shared/api'
import type { OrganizationNavigationLink } from '@golinks/shared/settings'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import LinkIcon from '@mui/icons-material/Link'
import MenuIcon from '@mui/icons-material/Menu'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { Link as RouterLink, useLocation } from 'react-router'
import type { ColorSchemeControl } from './colorScheme.ts'
import type { ShellSection } from './navigation.ts'
import { isSectionActive, sectionsFor } from './navigation.ts'
import { UserMenu } from './UserMenu.tsx'

const SECTION_ICONS = {
  directory: <FormatListBulletedIcon />,
  admin: <AdminPanelSettingsIcon />,
} as const

export interface ShellAppBarProps {
  /** The product title from branding, or the served default (spec 06 §2). */
  title: string
  logoUrl: string | null
  /** `null` while `/me` is on its way, and for a member with no session. */
  me: Me | null
  colorScheme: ColorSchemeControl
}

/** The organization's own links, minus the ones only admins may see. */
function visibleNavigationLinks(me: Me): OrganizationNavigationLink[] {
  return me.organization.navigationLinks.filter(
    (link) => !link.adminOnly || me.user.role === 'admin',
  )
}

export function ShellAppBar({ title, logoUrl, me, colorScheme }: ShellAppBarProps) {
  const { pathname } = useLocation()
  const [isDrawerOpen, setDrawerOpen] = useState(false)

  const sections: ShellSection[] = me === null ? [] : sectionsFor(me.user.role)
  const navigationLinks = me === null ? [] : visibleNavigationLinks(me)
  const hasNavigation = sections.length > 0

  return (
    <AppBar position="static" enableColorOnDark>
      <Toolbar sx={{ gap: { xs: 1, md: 2 } }}>
        {hasNavigation ? (
          <IconButton
            edge="start"
            color="inherit"
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
            sx={{ display: { md: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
        ) : null}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          {logoUrl === null ? (
            <LinkIcon />
          ) : (
            <Box component="img" src={logoUrl} alt="" sx={{ height: 24, width: 'auto' }} />
          )}
          <Typography variant="h6" component="p" noWrap sx={{ fontWeight: 500 }}>
            {title}
          </Typography>
          {me === null ? null : (
            <>
              <Divider
                orientation="vertical"
                flexItem
                sx={{
                  borderColor: 'currentColor',
                  opacity: 0.4,
                  my: 1.5,
                  display: { xs: 'none', sm: 'block' },
                }}
              />
              <Typography
                variant="body2"
                noWrap
                sx={{ opacity: 0.72, display: { xs: 'none', sm: 'block' } }}
              >
                {me.organization.id}
              </Typography>
            </>
          )}
        </Box>

        {hasNavigation ? (
          <Box
            component="nav"
            aria-label="Sections"
            sx={{ display: { xs: 'none', md: 'flex' }, alignSelf: 'stretch', ml: 2 }}
          >
            {sections.map((section) => {
              const isActive = isSectionActive(section, pathname)
              return (
                <Button
                  key={section.id}
                  component={RouterLink}
                  to={section.to}
                  color="inherit"
                  aria-current={isActive ? 'page' : undefined}
                  sx={{
                    alignSelf: 'stretch',
                    borderRadius: 0,
                    px: 1.5,
                    opacity: isActive ? 1 : 0.72,
                    borderBottom: '2px solid',
                    borderBottomColor: isActive ? 'currentColor' : 'transparent',
                  }}
                >
                  {section.label}
                </Button>
              )
            })}
            {navigationLinks.map((link) => (
              <Button
                key={`${link.text}:${link.url}`}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                color="inherit"
                endIcon={<OpenInNewIcon sx={{ fontSize: 16 }} />}
                sx={{ alignSelf: 'stretch', borderRadius: 0, px: 1.5, opacity: 0.72 }}
              >
                {link.text}
              </Button>
            ))}
          </Box>
        ) : null}

        <Box sx={{ flexGrow: 1 }} />

        {me === null ? null : (
          <UserMenu user={me.user} organizationId={me.organization.id} colorScheme={colorScheme} />
        )}
      </Toolbar>

      <Drawer anchor="left" open={isDrawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box
          component="nav"
          aria-label="Sections menu"
          sx={{ width: 260 }}
          onClick={() => setDrawerOpen(false)}
        >
          <Toolbar sx={{ gap: 1.25 }}>
            <Typography variant="h6" component="p" noWrap>
              {title}
            </Typography>
          </Toolbar>
          <Divider />
          <List>
            {sections.map((section) => (
              <ListItem key={section.id} disablePadding>
                <ListItemButton
                  component={RouterLink}
                  to={section.to}
                  selected={isSectionActive(section, pathname)}
                >
                  <ListItemIcon>{SECTION_ICONS[section.id]}</ListItemIcon>
                  <ListItemText primary={section.label} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
          {navigationLinks.length === 0 ? null : (
            <>
              <Divider />
              <List>
                {navigationLinks.map((link) => (
                  <ListItem key={`${link.text}:${link.url}`} disablePadding>
                    <ListItemButton href={link.url} target="_blank" rel="noreferrer">
                      <ListItemIcon>
                        <OpenInNewIcon />
                      </ListItemIcon>
                      <ListItemText primary={link.text} />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            </>
          )}
        </Box>
      </Drawer>
    </AppBar>
  )
}
