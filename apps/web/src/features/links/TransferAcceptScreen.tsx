/**
 * Accepting a link someone handed over (spec 03 §9.2, spec 08 §6).
 *
 * The whole screen is one question — do you want to own this link — so it shows
 * what is being offered before it shows the button: the keyword, where it
 * goes, who owns it now, and when the offer runs out. Every way an offer can
 * fail has its own sentence, because "invalid token" tells the member nothing
 * about what to do next.
 */

import type { TransferPreview, TransferStatus } from '@golinks/shared/api'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useNavigate } from 'react-router'
import { isApiError, isApiErrorCode } from '../../api/errors.ts'
import { FONT_MONO } from '../../app/theme.ts'
import { useAcceptTransfer, useTransferPreview } from '../../queries/transfers.ts'
import { formatExpiry, formatFullDate } from './format.ts'
import { useNotify } from './Notices.tsx'
import { useOrganizationContext } from './organization.ts'
import { shortForm, summaryAddress } from './paths.ts'

/** What each way of failing means, in the member's terms (spec 03 §9.2). */
const STATUS_EXPLANATION: Record<Exclude<TransferStatus, 'pending'>, string> = {
  expired: 'This transfer link has expired. Ask its owner to send you a new one.',
  accepted:
    'This transfer link has already been used. The link now belongs to whoever accepted it.',
  revoked:
    'This transfer link was replaced or withdrawn. Ask its owner to send you the current one.',
  invalid:
    'This transfer link is not valid. It may have been mistyped, or it may belong to another organization.',
}

const STATUS_TITLE: Record<Exclude<TransferStatus, 'pending'>, string> = {
  expired: 'Transfer expired',
  accepted: 'Already accepted',
  revoked: 'Transfer withdrawn',
  invalid: 'Transfer not found',
}

/**
 * The preview endpoint answers an unusable token with a refusal rather than a
 * status (spec 05 §4), so a failed read is read back into the same vocabulary
 * the screen already speaks.
 */
function statusFromError(error: unknown): Exclude<TransferStatus, 'pending'> | null {
  if (isApiErrorCode(error, 'transfer_expired')) {
    return 'expired'
  }
  if (isApiErrorCode(error, 'transfer_invalid')) {
    return 'invalid'
  }
  if (isApiErrorCode(error, ['transfer_owner_changed', 'transfer_creator_lost_access'])) {
    return 'revoked'
  }
  return null
}

export interface TransferAcceptScreenProps {
  token: string
}

export function TransferAcceptScreen({ token }: TransferAcceptScreenProps) {
  const navigate = useNavigate()
  const notify = useNotify()
  const organization = useOrganizationContext()
  const preview = useTransferPreview(token)
  const accept = useAcceptTransfer()

  const failure = preview.isError ? statusFromError(preview.error) : null
  const status: TransferStatus | null = preview.data?.status ?? failure

  async function takeOwnership() {
    try {
      const link = await accept.mutateAsync(token)
      notify(`You now own ${link.fullPath}`)
      void navigate(`/_/links/${link.id}`)
    } catch {
      // The refusal is rendered below.
    }
  }

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 640, mx: 'auto' }}>
      <Typography variant="h5" component="h1" sx={{ mb: 2 }}>
        Ownership transfer
      </Typography>

      {preview.isPending ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress aria-label="Loading the transfer" />
        </Box>
      ) : null}

      {preview.isError && failure === null ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void preview.refetch()}>
              Retry
            </Button>
          }
        >
          {isApiError(preview.error)
            ? preview.error.message
            : 'The transfer could not be loaded. Check your connection and try again.'}
        </Alert>
      ) : null}

      {status !== null && status !== 'pending' ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6">{STATUS_TITLE[status]}</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {STATUS_EXPLANATION[status]}
          </Typography>
          {preview.data ? <TransferSummary preview={preview.data} /> : null}
          <Button sx={{ mt: 3 }} onClick={() => void navigate('/')}>
            Back to directory
          </Button>
        </Paper>
      ) : null}

      {preview.data && preview.data.status === 'pending' ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <SwapHorizIcon color="primary" />
            <Typography variant="h6">Take ownership of {preview.data.link.fullPath}?</Typography>
          </Stack>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Accepting makes you responsible for this link: you can change where it points, rename
            it, or delete it. Nothing about how it resolves changes for anyone else.
          </Typography>

          <TransferSummary preview={preview.data} />

          {accept.isError ? (
            <Alert severity="error" sx={{ mt: 2 }}>
              {isApiError(accept.error)
                ? accept.error.message
                : 'The transfer could not be accepted. Try again.'}
            </Alert>
          ) : null}

          <Stack direction="row" spacing={1} sx={{ mt: 3 }}>
            <Button
              variant="contained"
              startIcon={<CheckCircleOutlineIcon />}
              disabled={accept.isPending}
              onClick={() => void takeOwnership()}
            >
              Take ownership
            </Button>
            <Button onClick={() => void navigate('/')}>Back to directory</Button>
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
            This offer expires {formatExpiry(preview.data.expiresAt)} (
            {formatFullDate(preview.data.expiresAt)}). Short form:{' '}
            {shortForm(
              summaryAddress(preview.data.link),
              organization.defaultNamespace,
              organization.shortHost,
            )}
            .
          </Typography>
        </Paper>
      ) : null}
    </Box>
  )
}

function TransferSummary({ preview }: { preview: TransferPreview }) {
  return (
    <Box sx={{ mt: 2 }}>
      <Divider />
      <Stack spacing={1} sx={{ mt: 2 }}>
        <Field label="Keyword" value={preview.link.fullPath} mono />
        <Field label="Destination" value={preview.link.destination} mono />
        <Field label="Current owner" value={preview.link.owner.email} />
      </Stack>
    </Box>
  )
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ wordBreak: 'break-all', ...(mono ? { fontFamily: FONT_MONO } : {}) }}
      >
        {value}
      </Typography>
    </Box>
  )
}
