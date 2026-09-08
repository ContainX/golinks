/**
 * The body of the link drawer, in its three views (ADR 0002 §3).
 *
 * There is one screen here, not three: the same fields in the same order, with
 * the controls the link's own `permissions` allow (spec 05 §2.1, spec 03 §5).
 * An owner edits everything; an admin additionally reassigns the owner; anyone
 * else reads it and is told, in one sentence, who to ask.
 */

import type { Link, LinkPatchBody } from '@golinks/shared/api'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useMemo, useState } from 'react'
import { usePatchLink } from '../../queries/links.ts'
import { UNLISTED_EXPLANATION } from '../directory/KeywordLabel.tsx'
import { copyToClipboard } from './clipboard.ts'
import { DeleteLinkDialog } from './DeleteLinkDialog.tsx'
import { ExistingLinkNotice } from './ExistingLinkNotice.tsx'
import type { LinkFieldErrors } from './errorFields.ts'
import { linkFieldErrors } from './errorFields.ts'
import { LinkStats } from './LinkStats.tsx'
import { useNotify } from './Notices.tsx'
import { OwnerField } from './OwnerField.tsx'
import type { OrganizationContext } from './organization.ts'
import { PlaceholderHelp } from './PlaceholderHelp.tsx'
import { linkAddress, shortForm } from './paths.ts'
import { TransferDialog } from './TransferDialog.tsx'
import {
  checkDestination,
  checkKeyword,
  expandedKeywordPreview,
  expandedPreview,
} from './validation.ts'

/** What a member who may not change a link is told (spec 03 §5). */
export const OWNERSHIP_NOTICE =
  'Only the owner or an admin can change this link. Anyone can use and share it.'

export interface LinkDetailProps {
  link: Link
  organization: OrganizationContext
  /** Closes the drawer and returns to the directory. */
  onClose: () => void
  /** Called after the link is deleted, so the drawer can leave. */
  onDeleted: () => void
  /** Opens another link's drawer, for a keyword collision. */
  onOpenLink: (link: Link) => void
}

export function LinkDetail({
  link,
  organization,
  onClose,
  onDeleted,
  onOpenLink,
}: LinkDetailProps) {
  const notify = useNotify()
  const patch = usePatchLink()

  const [namespace, setNamespace] = useState(link.namespace)
  const [keyword, setKeyword] = useState(link.displayKeyword)
  const [destination, setDestination] = useState(link.destination)
  const [isUnlisted, setIsUnlisted] = useState(link.isUnlisted)
  const [ownerId, setOwnerId] = useState(link.owner.id)
  const [serverErrors, setServerErrors] = useState<LinkFieldErrors>({})
  const [transferOpen, setTransferOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const { canEdit, canEditDestination, canDelete, canTransfer } = link.permissions
  const canReassign = organization.isAdmin
  const isReadOnlyView = !canEdit && !canEditDestination
  const isOwner = organization.userId !== null && link.owner.id === organization.userId
  const short = shortForm(linkAddress(link), organization.defaultNamespace, organization.shortHost)

  const keywordCheck = useMemo(
    () =>
      checkKeyword(keyword, organization.keywordRules, {
        namespace,
        defaultNamespace: organization.defaultNamespace,
        namespaces: organization.extraNamespaces,
      }),
    [keyword, namespace, organization],
  )
  const destinationCheck = useMemo(
    () => checkDestination(destination, keywordCheck.placeholderCount),
    [destination, keywordCheck.placeholderCount],
  )

  const errors: LinkFieldErrors = {
    ...serverErrors,
    ...(keywordCheck.error ? { keyword: keywordCheck.error } : {}),
    ...(destinationCheck.error ? { destination: destinationCheck.error } : {}),
  }

  const body = useMemo<LinkPatchBody>(() => {
    const changes: Record<string, unknown> = {}
    if (canEditDestination && destination.trim() !== link.destination) {
      changes.destination = destination.trim()
    }
    if (canEdit && keyword.trim() !== link.displayKeyword) {
      changes.keyword = keyword.trim()
    }
    if (canEdit && namespace !== link.namespace) {
      changes.namespace = namespace
    }
    if (canEdit && isUnlisted !== link.isUnlisted) {
      changes.isUnlisted = isUnlisted
    }
    if (canReassign && ownerId !== link.owner.id) {
      changes.ownerId = ownerId
    }
    return changes as LinkPatchBody
  }, [
    canEdit,
    canEditDestination,
    canReassign,
    destination,
    isUnlisted,
    keyword,
    link,
    namespace,
    ownerId,
  ])

  const isDirty = Object.keys(body).length > 0
  const canSave =
    isDirty &&
    keywordCheck.error === null &&
    destinationCheck.error === null &&
    !patch.isPending &&
    !organization.readOnly

  async function save() {
    setServerErrors({})
    try {
      await patch.mutateAsync({ id: link.id, body })
      notify(`Saved ${link.fullPath}`)
    } catch (error) {
      setServerErrors(linkFieldErrors(error))
    }
  }

  async function copyShortForm() {
    const copied = await copyToClipboard(short)
    notify(
      copied ? `Copied ${short}` : `Could not copy. The short form is ${short}`,
      copied ? 'success' : 'error',
    )
  }

  return (
    <Stack spacing={2.5} sx={{ p: 2.5, pt: 0 }}>
      <LinkStats
        visitCount={link.visitCount}
        lastVisitedAt={link.lastVisitedAt}
        createdAt={link.createdAt}
      />

      {isReadOnlyView ? (
        <Alert severity="info">
          Owned by <strong>{link.owner.email}</strong>. {OWNERSHIP_NOTICE}
        </Alert>
      ) : null}

      {organization.readOnly ? (
        <Alert severity="warning">
          This organization is read-only right now, so changes cannot be saved.
        </Alert>
      ) : null}

      {errors.general ? <Alert severity="error">{errors.general}</Alert> : null}

      {errors.existingLink ? (
        <ExistingLinkNotice
          link={errors.existingLink}
          message={errors.keyword}
          onOpen={onOpenLink}
        />
      ) : null}

      <Stack direction="row" spacing={2}>
        <TextField
          select={canEdit && organization.namespaces.length > 1}
          label="Namespace"
          size="small"
          value={namespace}
          onChange={(event) => setNamespace(event.target.value)}
          disabled={!canEdit}
          error={errors.namespace !== undefined}
          helperText={errors.namespace}
          sx={{ minWidth: 130 }}
          slotProps={canEdit ? undefined : { input: { readOnly: true } }}
        >
          {canEdit && organization.namespaces.length > 1
            ? organization.namespaces.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))
            : null}
        </TextField>

        <TextField
          label="Keyword"
          size="small"
          fullWidth
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          disabled={!canEdit}
          error={errors.keyword !== undefined}
          helperText={errors.existingLink ? undefined : errors.keyword}
          slotProps={canEdit ? undefined : { input: { readOnly: true } }}
        />
      </Stack>

      <TextField
        label="Destination"
        size="small"
        fullWidth
        value={destination}
        onChange={(event) => setDestination(event.target.value)}
        disabled={!canEditDestination}
        error={errors.destination !== undefined}
        helperText={errors.destination}
        slotProps={canEditDestination ? undefined : { input: { readOnly: true } }}
      />

      {keywordCheck.placeholderCount > 0 ? (
        <PlaceholderHelp
          keywordPreview={expandedKeywordPreview(keyword)}
          destinationPreview={expandedPreview(destination, keywordCheck.placeholderCount)}
          prefix={`${namespace}/`}
        />
      ) : null}

      <Box>
        <FormControlLabel
          control={
            <Switch
              checked={isUnlisted}
              disabled={!canEdit}
              onChange={(event) => setIsUnlisted(event.target.checked)}
            />
          }
          label="Unlisted"
        />
        <Typography variant="body2" color="text.secondary">
          {UNLISTED_EXPLANATION}
        </Typography>
      </Box>

      <Divider />

      <OwnerField
        owner={link.owner}
        value={ownerId}
        onChange={(id) => setOwnerId(id)}
        canReassign={canReassign}
        isSelf={isOwner}
        canTransfer={canTransfer && !organization.readOnly}
        onTransfer={() => setTransferOpen(true)}
        {...(errors.owner === undefined ? {} : { error: errors.owner })}
      />

      <Divider />

      {isReadOnlyView ? (
        <Stack direction="row" spacing={1}>
          <Button startIcon={<ContentCopyIcon />} onClick={() => void copyShortForm()}>
            Copy {short}
          </Button>
          <Button
            startIcon={<OpenInNewIcon />}
            href={link.destination}
            target="_blank"
            rel="noreferrer noopener"
            disabled={link.isProgrammatic}
          >
            Open destination
          </Button>
        </Stack>
      ) : (
        <Stack
          direction="row"
          spacing={1}
          sx={{ justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Button
            color="error"
            startIcon={<DeleteOutlineIcon />}
            disabled={!canDelete || organization.readOnly}
            onClick={() => setDeleteOpen(true)}
          >
            Delete link
          </Button>
          <Stack direction="row" spacing={1}>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="contained" disabled={!canSave} onClick={() => void save()}>
              Save changes
            </Button>
          </Stack>
        </Stack>
      )}

      <TransferDialog
        link={link}
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        organization={organization}
      />

      {deleteOpen ? (
        <DeleteLinkDialog
          link={link}
          open
          onClose={() => setDeleteOpen(false)}
          organization={organization}
          onDeleted={onDeleted}
        />
      ) : null}
    </Stack>
  )
}

/** The badge an admin sees on a link that is not theirs (ADR 0002 §3). */
export function AdminBadge() {
  return (
    <Chip
      size="small"
      variant="outlined"
      color="primary"
      icon={<ShieldOutlinedIcon />}
      label="Editing as admin"
    />
  )
}
