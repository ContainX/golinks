/**
 * The Events tab: the organization's audit trail (spec 07 §1, spec 08 §8).
 *
 * Every row is one append-only record of something that changed. What makes it
 * readable is the last column: `data` is a snapshot or a diff whose shape
 * depends on the type, and a diff is shown as the change it describes rather
 * than as JSON.
 */

import type { AuditEvent, AuditEventType } from '@golinks/shared/api'
import { AuditEventTypeSchema } from '@golinks/shared/api'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import type { AdminEventsFilters } from '../../../queries/admin.ts'
import { useAdminEvents, useAdminUsers } from '../../../queries/admin.ts'
import { formatEventTime } from '../adminFormat.ts'
import { useDebouncedValue } from '../useDebouncedValue.ts'

/** How many pairs of an unrecognized `data` payload are shown before it is cut off. */
const MAX_DATA_ENTRIES = 4

/** Longest a single value is rendered before it is elided. */
const MAX_VALUE_LENGTH = 60

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One value of an audit payload, short enough for a table cell. */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'none'
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text
}

/**
 * The lines one event's `data` is shown as.
 *
 * A `changes` diff (spec 07 §1.1) reads as `field: before → after`; anything
 * else is a snapshot, and its first few fields say enough to recognize it.
 */
export function eventDataLines(data: Record<string, unknown>): string[] {
  const changes = data.changes
  if (isRecord(changes)) {
    return Object.entries(changes).map(([field, change]) =>
      Array.isArray(change) && change.length === 2
        ? `${field}: ${formatValue(change[0])} → ${formatValue(change[1])}`
        : `${field}: ${formatValue(change)}`,
    )
  }
  return Object.entries(data)
    .slice(0, MAX_DATA_ENTRIES)
    .map(([field, value]) => `${field}: ${formatValue(value)}`)
}

/** Who caused an event, named as well as this screen can name them. */
function actorLabel(event: AuditEvent, emails: Map<string, string>): string {
  if (event.actorUserId === null) {
    return 'System'
  }
  return emails.get(event.actorUserId) ?? `Member ${event.actorUserId}`
}

export function AdminEventsView() {
  const [type, setType] = useState<AuditEventType | ''>('')
  const [linkId, setLinkId] = useState('')
  const [userId, setUserId] = useState('')

  const linkIdFilter = useDebouncedValue(linkId.trim())
  const userIdFilter = useDebouncedValue(userId.trim())

  const filters: AdminEventsFilters = {
    ...(type === '' ? {} : { type }),
    ...(linkIdFilter === '' ? {} : { linkId: linkIdFilter }),
    ...(userIdFilter === '' ? {} : { userId: userIdFilter }),
  }
  const events = useAdminEvents(filters)
  // The trail stores actor ids; the members listing is what turns them into
  // addresses. It is the same query the Users tab runs, so it costs nothing
  // extra once that tab has been opened.
  const members = useAdminUsers()

  const emails = new Map(
    (members.data?.pages.flatMap((page) => page.items) ?? []).map((user) => [user.id, user.email]),
  )
  const items = events.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <TextField
          select
          size="small"
          label="Type"
          value={type}
          onChange={(event) => setType(event.target.value as AuditEventType | '')}
          sx={{ width: 260 }}
        >
          <MenuItem value="">Any type</MenuItem>
          {AuditEventTypeSchema.options.map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Link id"
          value={linkId}
          onChange={(event) => setLinkId(event.target.value)}
          sx={{ width: 200 }}
        />
        <TextField
          size="small"
          label="User id"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          sx={{ width: 200 }}
        />
      </Stack>

      {events.isError ? <Alert severity="error">{events.error.message}</Alert> : null}

      <TableContainer component={Paper}>
        <Table aria-label="Audit events">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 160 }}>Time</TableCell>
              <TableCell sx={{ width: 220 }}>Type</TableCell>
              <TableCell sx={{ width: 220 }}>Actor</TableCell>
              <TableCell sx={{ width: 160 }}>Object</TableCell>
              <TableCell>Details</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((event) => (
              <TableRow key={event.id}>
                <TableCell sx={{ color: 'text.secondary' }}>
                  {formatEventTime(event.createdAt)}
                </TableCell>
                <TableCell>
                  <Chip size="small" variant="outlined" label={event.type} />
                </TableCell>
                <TableCell>{actorLabel(event, emails)}</TableCell>
                <TableCell>{`${event.objectType} ${event.objectId}`}</TableCell>
                <TableCell>
                  <Stack spacing={0.25}>
                    {eventDataLines(event.data).map((line) => (
                      <Typography key={line} variant="body2" sx={{ color: 'text.secondary' }}>
                        {line}
                      </Typography>
                    ))}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && !events.isPending ? (
              <TableRow>
                <TableCell colSpan={5} sx={{ color: 'text.secondary' }}>
                  No events match these filters.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        {events.isPending ? <CircularProgress size={20} aria-label="Loading events" /> : null}
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {items.length === 1 ? '1 event' : `${items.length} events`}
        </Typography>
        {events.hasNextPage ? (
          <Button
            variant="outlined"
            size="small"
            disabled={events.isFetchingNextPage}
            onClick={() => {
              void events.fetchNextPage()
            }}
          >
            Load more
          </Button>
        ) : null}
      </Stack>
    </Stack>
  )
}
