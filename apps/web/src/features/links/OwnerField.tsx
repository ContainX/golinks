/**
 * Who owns a link, and — for an admin — who should (spec 03 §5, §9.1).
 *
 * The owner is the one field whose control depends on the reader rather than on
 * the link: an owner sees their own address and a way to hand the link on, an
 * admin picks another member outright, and everyone else is told who to ask.
 * Only admins may list the organization's members, which is why the picker is
 * the admin's alone.
 */

import type { AdminUser, LinkOwner } from '@golinks/shared/api'
import PersonOutlineIcon from '@mui/icons-material/PersonOutlined'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useMemo, useState } from 'react'
import { useAdminUsers } from '../../queries/admin.ts'
import { useDebouncedValue } from '../directory/useDebouncedValue.ts'

/** What an admin can do with the owner field, in the words the drawer uses. */
export const ADMIN_OWNER_HELP =
  'As an admin you can hand this link to another member, for example when someone leaves.'

export interface OwnerFieldProps {
  /** The owner as the link resource carries them. */
  owner: LinkOwner
  /** The chosen owner id, which starts as the current one. */
  value: string
  onChange: (userId: string, email: string) => void
  /** Whether this member may reassign the owner directly (admins only). */
  canReassign: boolean
  /** Whether the owner is the signed-in member. */
  isSelf: boolean
  /** Whether a transfer link may be created (spec 03 §9.2). */
  canTransfer: boolean
  onTransfer: () => void
  error?: string | undefined
}

export function OwnerField({
  owner,
  value,
  onChange,
  canReassign,
  isSelf,
  canTransfer,
  onTransfer,
  error,
}: OwnerFieldProps) {
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search)

  const members = useAdminUsers(debounced.trim().length > 0 ? { q: debounced.trim() } : {}, {
    enabled: canReassign,
  })

  const options = useMemo<AdminUser[]>(
    () => members.data?.pages.flatMap((page) => page.items) ?? [],
    [members.data],
  )

  const selected = useMemo(
    () => options.find((member) => member.id === value) ?? null,
    [options, value],
  )

  if (canReassign) {
    return (
      <Box>
        <Autocomplete
          options={options}
          value={selected}
          loading={members.isFetching}
          getOptionLabel={(member) => member.email}
          isOptionEqualToValue={(option, current) => option.id === current.id}
          onInputChange={(_event, next) => setSearch(next)}
          onChange={(_event, member) => {
            if (member) {
              onChange(member.id, member.email)
            }
          }}
          noOptionsText={
            debounced.trim().length > 0 ? 'No member matches' : 'Type to search members'
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label="Owner"
              placeholder={value === owner.id ? owner.email : undefined}
              helperText={error ?? ADMIN_OWNER_HELP}
              error={error !== undefined}
            />
          )}
        />
      </Box>
    )
  }

  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ alignItems: 'center', justifyContent: 'space-between' }}
    >
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Owner
        </Typography>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <PersonOutlineIcon fontSize="small" sx={{ color: 'text.disabled' }} />
          <Typography variant="body2">
            {owner.email}
            {isSelf ? ' (you)' : ''}
          </Typography>
        </Stack>
        {error ? (
          <Typography variant="caption" color="error">
            {error}
          </Typography>
        ) : null}
      </Box>
      {canTransfer ? (
        <Button size="small" startIcon={<SwapHorizIcon />} onClick={onTransfer}>
          Transfer
        </Button>
      ) : null}
    </Stack>
  )
}
