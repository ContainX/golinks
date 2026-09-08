/**
 * Search, filter chips, and the sort control above the directory table
 * (ADR 0002 §1, §2).
 *
 * The search field does two jobs at once: it narrows the listing as the member
 * types, and when what they typed *is* a keyword it offers to go there. Both
 * are the same box because they are the same intention — a member who types
 * `handbook` either wants the link or wants to see it.
 */

import type { Link, LinkSort } from '@golinks/shared/api'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import SearchIcon from '@mui/icons-material/Search'
import SortIcon from '@mui/icons-material/Sort'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import InputAdornment from '@mui/material/InputAdornment'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import type { KeyboardEvent, ReactElement } from 'react'
import { useState } from 'react'
import type { DirectoryFilterId } from './filters.ts'
import { namespaceFilter, SORT_OPTIONS, sortOption } from './filters.ts'

export interface DirectoryToolbarProps {
  search: string
  onSearchChange: (value: string) => void
  /** The link the typed text names exactly, or `null` (ADR 0002 §2). */
  goTarget: Link | null
  onGo: (link: Link) => void
  filter: DirectoryFilterId
  onFilterChange: (filter: DirectoryFilterId) => void
  /** Every namespace of the organization, default first. */
  namespaces: readonly string[]
  /** Whether the member has unlisted links to filter to (spec 03 §4). */
  showUnlisted: boolean
  sort: LinkSort
  onSortChange: (sort: LinkSort) => void
}

export const SEARCH_PLACEHOLDER = 'Search keyword, destination, or owner'

export function DirectoryToolbar({
  search,
  onSearchChange,
  goTarget,
  onGo,
  filter,
  onFilterChange,
  namespaces,
  showUnlisted,
  sort,
  onSortChange,
}: DirectoryToolbarProps) {
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null)
  const selected = sortOption(sort)

  function handleSearchKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Enter goes to the keyword only when the typed text is one; otherwise the
    // field has already done its work and there is nothing to do (ADR 0002 §2).
    if (event.key === 'Enter' && goTarget !== null) {
      event.preventDefault()
      onGo(goTarget)
    }
  }

  const chips: { id: DirectoryFilterId; label: string; icon?: ReactElement }[] = [
    { id: 'all', label: 'All' },
    { id: 'mine', label: 'Mine' },
    ...namespaces.map((namespace) => ({ id: namespaceFilter(namespace), label: namespace })),
    { id: 'programmatic', label: 'Programmatic' },
    ...(showUnlisted
      ? [
          {
            id: 'unlisted' as DirectoryFilterId,
            label: 'Unlisted',
            icon: <VisibilityOffIcon fontSize="small" />,
          },
        ]
      : []),
  ]

  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      spacing={2}
      sx={{
        alignItems: { xs: 'stretch', md: 'center' },
        justifyContent: 'space-between',
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ flexGrow: 1, minWidth: 0, alignItems: { xs: 'stretch', sm: 'center' } }}
      >
        <TextField
          size="small"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder={SEARCH_PLACEHOLDER}
          sx={{ minWidth: { sm: 280 } }}
          slotProps={{
            htmlInput: { 'aria-label': 'Search links' },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment:
                goTarget === null ? null : (
                  <InputAdornment position="end">
                    <Tooltip title={`Go to ${goTarget.fullPath}`}>
                      <Chip
                        size="small"
                        color="primary"
                        clickable
                        icon={<ArrowForwardIcon />}
                        label="Go"
                        onClick={() => onGo(goTarget)}
                      />
                    </Tooltip>
                  </InputAdornment>
                ),
            },
          }}
        />

        <Box
          role="group"
          aria-label="Filter links"
          sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}
        >
          {chips.map((chip) => (
            <Chip
              key={chip.id}
              label={chip.label}
              {...(chip.icon ? { icon: chip.icon } : {})}
              size="small"
              clickable
              aria-pressed={filter === chip.id}
              color={filter === chip.id ? 'primary' : 'default'}
              variant={filter === chip.id ? 'filled' : 'outlined'}
              onClick={() => onFilterChange(chip.id)}
            />
          ))}
        </Box>
      </Stack>

      <Box>
        <Button
          size="small"
          color="inherit"
          startIcon={<SortIcon />}
          endIcon={<ArrowDropDownIcon />}
          aria-haspopup="listbox"
          aria-label={`Sort: ${selected.label}`}
          onClick={(event) => setSortAnchor(event.currentTarget)}
        >
          {selected.label}
        </Button>
        <Menu
          anchorEl={sortAnchor}
          open={sortAnchor !== null}
          onClose={() => setSortAnchor(null)}
          slotProps={{ list: { role: 'listbox' } }}
        >
          {SORT_OPTIONS.map((option) => (
            <MenuItem
              key={option.id}
              selected={option.id === sort}
              onClick={() => {
                onSortChange(option.id)
                setSortAnchor(null)
              }}
            >
              {option.label}
            </MenuItem>
          ))}
        </Menu>
      </Box>
    </Stack>
  )
}
