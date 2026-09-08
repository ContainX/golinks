/**
 * The directory (ADR 0002 §1, §2, §8, §9).
 *
 * Everything an organization's links can be asked for is on one screen: create
 * at the top, then search, chips and sort, then the links themselves. The
 * listing is a keyset-paged infinite query (spec 03 §10.1), so "Load more" adds
 * a page rather than jumping to one, and nothing here ever holds the whole
 * directory in memory.
 */

import type { Link, LinkSort } from '@golinks/shared/api'
import AddIcon from '@mui/icons-material/Add'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Fab from '@mui/material/Fab'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import { useTheme } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { browserNavigation } from '../../api/http.ts'
import { useLinks } from '../../queries/links.ts'
import { CreateLinkBar } from '../links/CreateLinkBar.tsx'
import { CreateLinkDialog } from '../links/CreateLinkDialog.tsx'
import { copyToClipboard } from '../links/clipboard.ts'
import { DeleteLinkDialog } from '../links/DeleteLinkDialog.tsx'
import { useNotify } from '../links/Notices.tsx'
import type { OrganizationContext } from '../links/organization.ts'
import { findTypedLink, linkAddress, resolverPath, shortForm } from '../links/paths.ts'
import { TransferDialog } from '../links/TransferDialog.tsx'
import { DirectoryNoResults, DirectoryOnboarding } from './DirectoryEmptyState.tsx'
import { DirectoryList } from './DirectoryList.tsx'
import { DirectoryTable } from './DirectoryTable.tsx'
import { DirectoryToolbar } from './DirectoryToolbar.tsx'
import type { DirectoryFilterId } from './filters.ts'
import { ALL_FILTER, DEFAULT_SORT, directoryQuery, isClientSideFilter } from './filters.ts'
import { useDebouncedValue } from './useDebouncedValue.ts'

export interface DirectoryScreenProps {
  organization: OrganizationContext
}

/** Links a member just created, kept at the top until the filters change. */
function withRecentlyCreated(created: readonly Link[], loaded: readonly Link[]): Link[] {
  if (created.length === 0) {
    return [...loaded]
  }
  const createdIds = new Set(created.map((link) => link.id))
  return [...created, ...loaded.filter((link) => !createdIds.has(link.id))]
}

export function DirectoryScreen({ organization }: DirectoryScreenProps) {
  const navigate = useNavigate()
  const notify = useNotify()
  const theme = useTheme()
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'))

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<DirectoryFilterId>(ALL_FILTER)
  const [sort, setSort] = useState<LinkSort>(DEFAULT_SORT)
  const [created, setCreated] = useState<Link[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [transferLink, setTransferLink] = useState<Link | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Link | null>(null)

  const debouncedSearch = useDebouncedValue(search)
  const query = useMemo(
    () => directoryQuery({ search: debouncedSearch, filter, sort }),
    [debouncedSearch, filter, sort],
  )

  const links = useLinks(query)

  const loaded = useMemo(() => links.data?.pages.flatMap((page) => page.items) ?? [], [links.data])
  const isFiltered = debouncedSearch.trim().length > 0 || filter !== ALL_FILTER

  const rows = useMemo(() => {
    // A link just created is pinned to the top so that it can be seen at all:
    // the default sort is by visits, and a new link has none. It is dropped
    // again as soon as the member narrows the directory, where a row that does
    // not match the filter would be a lie.
    const combined = isFiltered ? [...loaded] : withRecentlyCreated(created, loaded)
    // The listing endpoint has no unlisted parameter (spec 03 §10.1); the
    // visibility rule of §4 is already applied for the viewer, so this chip
    // narrows what came back rather than what was asked for.
    return isClientSideFilter(filter) ? combined.filter((link) => link.isUnlisted) : combined
  }, [created, filter, isFiltered, loaded])

  const goTarget = useMemo(
    () => findTypedLink(search, rows, organization.defaultNamespace, organization.shortHost),
    [organization.defaultNamespace, organization.shortHost, rows, search],
  )

  // Offered only to a member who has somewhere to go with it (spec 03 §4).
  const showUnlisted =
    organization.isAdmin ||
    loaded.some((link) => link.isUnlisted && link.owner.id === organization.userId)

  const isEmpty = !links.isPending && rows.length === 0

  function resetFilters() {
    setSearch('')
    setFilter(ALL_FILTER)
  }

  function changeFilter(next: DirectoryFilterId) {
    setFilter(next)
    setCreated([])
  }

  function changeSort(next: LinkSort) {
    setSort(next)
    setCreated([])
  }

  function openLink(link: Link) {
    void navigate(`/_/links/${link.id}`, { state: { fromDirectory: true } })
  }

  async function copyShortForm(link: Link) {
    const text = shortForm(linkAddress(link), organization.defaultNamespace, organization.shortHost)
    const copied = await copyToClipboard(text)
    notify(
      copied ? `Copied ${text}` : `Could not copy. The short form is ${text}`,
      copied ? 'success' : 'error',
    )
  }

  function goToLink(link: Link) {
    // A full navigation, not a client route: the resolver owns keyword paths and
    // records the visit (spec 04 §1, spec 07).
    browserNavigation.navigate(`/${resolverPath(linkAddress(link), organization.defaultNamespace)}`)
  }

  function handleCreated(link: Link) {
    setCreated((current) => [link, ...current.filter((existing) => existing.id !== link.id)])
    notify(
      `Created ${shortForm(linkAddress(link), organization.defaultNamespace, organization.shortHost)}`,
    )
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, pb: { xs: 12, md: 3 } }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h5" component="h1">
            Directory
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {`Type ${organization.shortHost}/keyword in the browser to use a link.`}
          </Typography>
        </Box>
        {isNarrow ? null : (
          <CreateLinkBar
            organization={organization}
            onCreated={handleCreated}
            onOpenExisting={openLink}
          />
        )}

        <Paper variant="outlined">
          <Box sx={{ p: 2 }}>
            <DirectoryToolbar
              search={search}
              onSearchChange={setSearch}
              goTarget={goTarget}
              onGo={goToLink}
              filter={filter}
              onFilterChange={changeFilter}
              namespaces={organization.namespaces}
              showUnlisted={showUnlisted}
              sort={sort}
              onSortChange={changeSort}
            />
          </Box>
          <Divider />

          {links.isError ? (
            <Box sx={{ p: 2 }}>
              <Alert
                severity="error"
                action={
                  <Button color="inherit" size="small" onClick={() => void links.refetch()}>
                    Retry
                  </Button>
                }
              >
                The directory could not be loaded.
              </Alert>
            </Box>
          ) : links.isPending ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress aria-label="Loading links" />
            </Box>
          ) : isEmpty && !isFiltered ? (
            <DirectoryOnboarding
              shortHost={organization.shortHost}
              baseUrl={organization.baseUrl}
              defaultNamespace={organization.defaultNamespace}
            />
          ) : isEmpty ? (
            <DirectoryNoResults onClear={resetFilters} />
          ) : isNarrow ? (
            <DirectoryList
              links={rows}
              defaultNamespace={organization.defaultNamespace}
              shortHost={organization.shortHost}
              onOpen={openLink}
              onCopy={(link) => void copyShortForm(link)}
            />
          ) : (
            <DirectoryTable
              links={rows}
              currentUserId={organization.userId}
              defaultNamespace={organization.defaultNamespace}
              shortHost={organization.shortHost}
              onOpen={openLink}
              onCopy={(link) => void copyShortForm(link)}
              onTransfer={setTransferLink}
              onDelete={setDeleteTarget}
            />
          )}

          {rows.length === 0 ? null : (
            <>
              <Divider />
              <Stack
                direction="row"
                spacing={2}
                sx={{ p: 1.5, alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Typography variant="body2" color="text.secondary">
                  {rows.length} link{rows.length === 1 ? '' : 's'} shown
                </Typography>
                {links.hasNextPage ? (
                  <Button
                    size="small"
                    onClick={() => void links.fetchNextPage()}
                    disabled={links.isFetchingNextPage}
                  >
                    {links.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </Button>
                ) : null}
              </Stack>
            </>
          )}
        </Paper>
      </Stack>

      {isNarrow ? (
        <>
          <Fab
            color="primary"
            aria-label="Create a link"
            onClick={() => setCreateOpen(true)}
            sx={{ position: 'fixed', bottom: 24, right: 24 }}
          >
            <AddIcon />
          </Fab>
          <CreateLinkDialog
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            organization={organization}
            onCreated={handleCreated}
            onOpenExisting={openLink}
          />
        </>
      ) : null}

      {transferLink === null ? null : (
        <TransferDialog
          link={transferLink}
          open
          onClose={() => setTransferLink(null)}
          organization={organization}
        />
      )}

      {deleteTarget === null ? null : (
        <DeleteLinkDialog
          link={deleteTarget}
          open
          onClose={() => setDeleteTarget(null)}
          organization={organization}
          onDeleted={() => setDeleteTarget(null)}
        />
      )}
    </Box>
  )
}
