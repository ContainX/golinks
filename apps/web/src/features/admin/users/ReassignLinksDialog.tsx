/**
 * Handing every link a member owns to someone else (ADR 0002 §7).
 *
 * There is no bulk endpoint for this: ownership moves one link at a time
 * through `PATCH /links/:id` (spec 03 §7), so the dialog names the links it is
 * about to move, counts them off as it goes, and says which ones the API
 * refused rather than reporting a single yes or no.
 */

import type { AdminUser, Link } from '@golinks/shared/api'
import { MAX_LIST_LIMIT } from '@golinks/shared/api'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import type { ReassignLinkFailure } from '../../../queries/admin.ts'
import { useAdminUserLinks, useAdminUsers, useReassignLinks } from '../../../queries/admin.ts'
import { formatLinkCount } from '../adminFormat.ts'
import { useDebouncedValue } from '../useDebouncedValue.ts'

/** How many links are named before the list turns into a count. */
const NAMED_LINKS = 5

export interface ReassignLinksDialogProps {
  /** The member whose links are moving. */
  user: AdminUser
  onClose: () => void
  /** Reports a finished move, for the screen's snackbar. */
  onReassigned: (message: string) => void
}

export function ReassignLinksDialog({ user, onClose, onReassigned }: ReassignLinksDialogProps) {
  const [owner, setOwner] = useState<AdminUser | null>(null)
  const [completed, setCompleted] = useState(0)
  const [total, setTotal] = useState(0)
  const [failures, setFailures] = useState<ReassignLinkFailure[]>([])

  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search)

  const owned = useAdminUserLinks(user.id)
  // Only an enabled member may own a link (spec 05 §4, `owner_invalid`), so the chooser
  // lists exactly those, minus the member the links are leaving. The search is the API's,
  // so an organization larger than one page can still reach every candidate.
  const candidates = useAdminUsers({
    enabled: true,
    limit: MAX_LIST_LIMIT,
    ...(debounced.trim().length > 0 ? { q: debounced.trim() } : {}),
  })
  const reassign = useReassignLinks()

  const links: Link[] = owned.data?.items ?? []
  const options = (candidates.data?.pages.flatMap((page) => page.items) ?? []).filter(
    (candidate) => candidate.id !== user.id,
  )

  function submit(): void {
    if (owner === null || links.length === 0) {
      return
    }
    const movingTo = owner
    setFailures([])
    setCompleted(0)
    setTotal(links.length)
    reassign.mutate(
      { links, ownerId: movingTo.id, onProgress: setCompleted },
      {
        onSuccess: (result) => {
          if (result.moved.length > 0) {
            onReassigned(`Moved ${formatLinkCount(result.moved.length)} to ${movingTo.email}.`)
          }
          if (result.failures.length === 0) {
            onClose()
            return
          }
          setFailures(result.failures)
        },
      },
    )
  }

  return (
    <Dialog open onClose={reassign.isPending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{`Reassign ${user.email}'s links`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <DialogContentText>
            {user.isEnabled
              ? `${user.email} owns ${formatLinkCount(links.length)}. Choose who owns them from now on.`
              : `${user.email} is disabled. Their ${formatLinkCount(links.length)} keep working; choose who owns them from now on.`}
          </DialogContentText>

          <Autocomplete
            options={options}
            value={owner}
            onChange={(_event, value) => setOwner(value)}
            getOptionLabel={(option) => option.email}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            onInputChange={(_event, next) => setSearch(next)}
            filterOptions={(all) => all}
            disabled={reassign.isPending}
            loading={candidates.isFetching}
            noOptionsText={debounced.trim().length > 0 ? 'No member matches' : 'No other members'}
            renderInput={(params) => <TextField {...params} label="New owner" />}
          />

          {owned.isPending ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CircularProgress size={18} aria-label="Loading links" />
              <Typography variant="body2">Loading this member's links…</Typography>
            </Stack>
          ) : null}

          {owned.isError ? <Alert severity="error">{owned.error.message}</Alert> : null}

          {links.length > 0 ? (
            <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, p: 1.5 }}>
              <Stack spacing={0.75}>
                {links.slice(0, NAMED_LINKS).map((link) => (
                  <Stack
                    key={link.id}
                    direction="row"
                    sx={{ justifyContent: 'space-between', gap: 2 }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {link.fullPath}
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {`${link.visitCount} visits`}
                    </Typography>
                  </Stack>
                ))}
                {links.length > NAMED_LINKS ? (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {`and ${links.length - NAMED_LINKS} more`}
                  </Typography>
                ) : null}
              </Stack>
            </Box>
          ) : null}

          {owned.data && !owned.data.complete ? (
            <Alert severity="info">
              This member owns more links than this dialog gathered. Reassign these, then open it
              again for the rest.
            </Alert>
          ) : null}

          {reassign.isPending ? (
            <Box>
              <LinearProgress
                variant="determinate"
                value={total === 0 ? 0 : (completed / total) * 100}
              />
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                {`Reassigned ${completed} of ${total}…`}
              </Typography>
            </Box>
          ) : null}

          {failures.length > 0 ? (
            <Alert severity="warning">
              <AlertTitle>
                {`${formatLinkCount(failures.length)} could not be reassigned`}
              </AlertTitle>
              <Stack spacing={0.5}>
                {failures.map((failure) => (
                  <Typography key={failure.link.id} variant="body2">
                    {`${failure.link.fullPath}: ${failure.message}`}
                  </Typography>
                ))}
              </Stack>
            </Alert>
          ) : null}

          {reassign.isError ? <Alert severity="error">{reassign.error.message}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={reassign.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={owner === null || links.length === 0 || reassign.isPending}
        >
          {`Reassign ${formatLinkCount(links.length)}`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
