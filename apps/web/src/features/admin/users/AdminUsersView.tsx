/**
 * The Users tab (ADR 0002 §7, spec 08 §8).
 *
 * Search and the filter chips are the query the table pages over, and the row
 * menu is the whole of what an admin may do to a member: enable or disable
 * them, change their role, and hand their links to someone else.
 */

import type { AdminUser, AdminUserPatchBody } from '@golinks/shared/api'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import BlockIcon from '@mui/icons-material/Block'
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import PersonIcon from '@mui/icons-material/Person'
import SearchIcon from '@mui/icons-material/Search'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import Alert from '@mui/material/Alert'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { isApiErrorCode } from '../../../api/errors.ts'
import type { AdminUsersFilters } from '../../../queries/admin.ts'
import { useAdminUsers, usePatchAdminUser } from '../../../queries/admin.ts'
import { useMe } from '../../../queries/me.ts'
import { formatLinkCount, formatRelativeTime, memberInitials } from '../adminFormat.ts'
import { useDebouncedValue } from '../useDebouncedValue.ts'
import { ReassignLinksDialog } from './ReassignLinksDialog.tsx'

/** The chips above the table, each a filter the API already understands. */
const USER_FILTERS = [
  { value: 'all', label: 'All', filters: {} },
  { value: 'admins', label: 'Admins', filters: { role: 'admin' } },
  { value: 'disabled', label: 'Disabled', filters: { enabled: false } },
] as const satisfies ReadonlyArray<{ value: string; label: string; filters: AdminUsersFilters }>

type UserFilterName = (typeof USER_FILTERS)[number]['value']

/** What the snackbar is currently saying, if anything. */
interface Notice {
  severity: 'success' | 'error'
  message: string
}

/** The row whose menu is open, and the button it hangs off. */
interface OpenMenu {
  anchor: HTMLElement
  user: AdminUser
}

function filtersFor(name: UserFilterName, q: string): AdminUsersFilters {
  const chosen = USER_FILTERS.find((filter) => filter.value === name)
  return { ...(chosen?.filters ?? {}), ...(q === '' ? {} : { q }) }
}

export function AdminUsersView() {
  const me = useMe()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<UserFilterName>('all')
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [reassigning, setReassigning] = useState<AdminUser | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const query = useDebouncedValue(search.trim())
  const users = useAdminUsers(filtersFor(filter, query))
  const patchUser = usePatchAdminUser()

  const members = users.data?.pages.flatMap((page) => page.items) ?? []
  const signedInId = me.data?.user.id

  function changeMember(user: AdminUser, body: AdminUserPatchBody, done: string): void {
    setMenu(null)
    patchUser.mutate(
      { id: user.id, body },
      {
        onSuccess: () => setNotice({ severity: 'success', message: done }),
        onError: (error) =>
          setNotice({
            severity: 'error',
            // Spec 05 §4: an admin acting on their own account is refused. The
            // row's menu is disabled for exactly that reason, so this is the
            // answer to a race — a role changed in another tab, say — and it is
            // said plainly rather than as a raw code.
            message: isApiErrorCode(error, 'cannot_modify_self')
              ? 'You cannot change your own account.'
              : error.message,
          }),
      },
    )
  }

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
      >
        <TextField
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search members"
          label="Search members"
          size="small"
          sx={{ width: { xs: '100%', md: 360 } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Stack direction="row" spacing={1}>
          {USER_FILTERS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              color={filter === option.value ? 'primary' : 'default'}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            />
          ))}
        </Stack>
      </Stack>

      {users.isError ? <Alert severity="error">{users.error.message}</Alert> : null}

      <TableContainer component={Paper}>
        <Table aria-label="Members">
          <TableHead>
            <TableRow>
              <TableCell>Member</TableCell>
              <TableCell sx={{ width: 120 }}>Role</TableCell>
              <TableCell sx={{ width: 120 }}>Status</TableCell>
              <TableCell sx={{ width: 100 }}>Links</TableCell>
              <TableCell sx={{ width: 140 }}>Last sign-in</TableCell>
              <TableCell sx={{ width: 96 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {members.map((user) => {
              const isSelf = user.id === signedInId
              return (
                <TableRow key={user.id} sx={{ opacity: user.isEnabled ? 1 : 0.7 }}>
                  <TableCell>
                    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                      <Avatar sx={{ width: 28, height: 28, fontSize: 12 }}>
                        {memberInitials(user.email)}
                      </Avatar>
                      <Typography variant="body2">{user.email}</Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>{user.role === 'admin' ? 'Admin' : 'Member'}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={user.isEnabled ? 'success' : 'error'}
                      label={user.isEnabled ? 'Active' : 'Disabled'}
                    />
                  </TableCell>
                  <TableCell>{formatLinkCount(user.linkCount)}</TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>
                    {formatRelativeTime(user.lastLoginAt)}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={isSelf ? 'You cannot change your own account.' : ''}>
                      <Box component="span" sx={{ display: 'inline-flex' }}>
                        <IconButton
                          aria-label={`Actions for ${user.email}`}
                          disabled={isSelf}
                          onClick={(event) => setMenu({ anchor: event.currentTarget, user })}
                        >
                          <MoreVertIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              )
            })}
            {members.length === 0 && !users.isPending ? (
              <TableRow>
                <TableCell colSpan={6} sx={{ color: 'text.secondary' }}>
                  No members match these filters.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        {users.isPending ? <CircularProgress size={20} aria-label="Loading members" /> : null}
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {members.length === 1 ? '1 member' : `${members.length} members`}
        </Typography>
        {users.hasNextPage ? (
          <Button
            variant="outlined"
            size="small"
            disabled={users.isFetchingNextPage}
            onClick={() => {
              void users.fetchNextPage()
            }}
          >
            Load more
          </Button>
        ) : null}
      </Stack>

      <Menu anchorEl={menu?.anchor ?? null} open={menu !== null} onClose={() => setMenu(null)}>
        {menu === null
          ? null
          : [
              <MenuItem
                key="enabled"
                disabled={patchUser.isPending}
                onClick={() =>
                  changeMember(
                    menu.user,
                    { isEnabled: !menu.user.isEnabled },
                    menu.user.isEnabled
                      ? `${menu.user.email} can no longer sign in.`
                      : `${menu.user.email} can sign in again.`,
                  )
                }
              >
                <ListItemIcon>
                  {menu.user.isEnabled ? (
                    <BlockIcon fontSize="small" />
                  ) : (
                    <CheckCircleOutlinedIcon fontSize="small" />
                  )}
                </ListItemIcon>
                <ListItemText>{menu.user.isEnabled ? 'Disable' : 'Enable'}</ListItemText>
              </MenuItem>,
              <MenuItem
                key="role"
                disabled={patchUser.isPending}
                onClick={() =>
                  changeMember(
                    menu.user,
                    { role: menu.user.role === 'admin' ? 'member' : 'admin' },
                    menu.user.role === 'admin'
                      ? `${menu.user.email} is now a member.`
                      : `${menu.user.email} is now an admin.`,
                  )
                }
              >
                <ListItemIcon>
                  {menu.user.role === 'admin' ? (
                    <PersonIcon fontSize="small" />
                  ) : (
                    <AdminPanelSettingsIcon fontSize="small" />
                  )}
                </ListItemIcon>
                <ListItemText>
                  {menu.user.role === 'admin' ? 'Make member' : 'Make admin'}
                </ListItemText>
              </MenuItem>,
              <Divider key="divider" />,
              <MenuItem
                key="reassign"
                disabled={menu.user.linkCount === 0}
                onClick={() => {
                  setReassigning(menu.user)
                  setMenu(null)
                }}
              >
                <ListItemIcon>
                  <SwapHorizIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Reassign links…</ListItemText>
              </MenuItem>,
            ]}
      </Menu>

      {reassigning === null ? null : (
        <ReassignLinksDialog
          user={reassigning}
          onClose={() => setReassigning(null)}
          onReassigned={(message) => setNotice({ severity: 'success', message })}
        />
      )}

      <Snackbar
        open={notice !== null}
        autoHideDuration={6000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={notice?.severity ?? 'success'} onClose={() => setNotice(null)}>
          {notice?.message ?? ''}
        </Alert>
      </Snackbar>
    </Stack>
  )
}
