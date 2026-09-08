/**
 * The fields a link is created from, in the two shapes the app needs them:
 * one line above the directory on a laptop, and stacked in a dialog on a phone
 * (ADR 0002 §1, §9).
 *
 * Both shapes are the same form, so the fields, their messages, the `%s` help,
 * and the conflict notice are written once and laid out twice.
 */

import type { Link } from '@golinks/shared/api'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { FormEvent } from 'react'
import type { CreateLinkForm } from './createLinkForm.ts'
import { ExistingLinkNotice } from './ExistingLinkNotice.tsx'
import type { OrganizationContext } from './organization.ts'
import { PlaceholderHelp } from './PlaceholderHelp.tsx'

export interface CreateLinkFieldsProps {
  form: CreateLinkForm
  organization: OrganizationContext
  /** `bar` puts everything on one line; `stacked` fills a dialog. */
  layout: 'bar' | 'stacked'
  /** Opens the drawer of the link a keyword collided with. */
  onOpenExisting: (link: Link) => void
  /** Rendered under the fields in the bar; the dialog puts it in its actions. */
  submitLabel?: string
}

/** The explanation the create bar carries under it (ADR 0002 §1). */
export const CREATE_HELP =
  'Anyone can create a link. You become its owner; only you or an admin can change it later.'

export function CreateLinkFields({
  form,
  organization,
  layout,
  onOpenExisting,
  submitLabel = 'Create',
}: CreateLinkFieldsProps) {
  const stacked = layout === 'stacked'
  const hasNamespaceChoice = organization.namespaces.length > 1

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (form.canSubmit) {
      void form.submit()
    }
  }

  const keywordPrefix = hasNamespaceChoice ? '' : `${organization.defaultNamespace}/`

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      <Stack
        direction={stacked ? 'column' : { xs: 'column', md: 'row' }}
        spacing={stacked ? 2 : 1.5}
        sx={{ alignItems: stacked ? 'stretch' : { xs: 'stretch', md: 'flex-start' } }}
      >
        {hasNamespaceChoice ? (
          <TextField
            select
            size="small"
            label="Namespace"
            value={form.namespace}
            onChange={(event) => form.setNamespace(event.target.value)}
            error={form.errors.namespace !== undefined}
            helperText={form.errors.namespace}
            sx={stacked ? undefined : { minWidth: 120 }}
          >
            {organization.namespaces.map((namespace) => (
              <MenuItem key={namespace} value={namespace}>
                {namespace}
              </MenuItem>
            ))}
          </TextField>
        ) : null}

        <TextField
          size="small"
          label="Keyword"
          placeholder="keyword"
          value={form.keyword}
          onChange={(event) => form.setKeyword(event.target.value)}
          error={form.errors.keyword !== undefined}
          // The conflict notice below carries the API's own wording, so the
          // field is marked but not made to repeat it.
          helperText={form.errors.existingLink ? undefined : form.errors.keyword}
          slotProps={
            keywordPrefix === ''
              ? undefined
              : {
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">{keywordPrefix}</InputAdornment>
                    ),
                  },
                }
          }
          sx={stacked ? undefined : { minWidth: 220 }}
        />

        {stacked ? null : (
          <ArrowForwardIcon
            fontSize="small"
            sx={{ color: 'text.disabled', mt: 1.2, display: { xs: 'none', md: 'block' } }}
          />
        )}

        <TextField
          size="small"
          label="Destination"
          placeholder="Paste the destination URL"
          value={form.destination}
          onChange={(event) => form.setDestination(event.target.value)}
          error={form.errors.destination !== undefined}
          helperText={form.errors.destination}
          sx={stacked ? undefined : { flexGrow: 1 }}
        />

        {stacked ? null : (
          <Button type="submit" variant="contained" disabled={!form.canSubmit} sx={{ px: 3 }}>
            {submitLabel}
          </Button>
        )}
      </Stack>

      {form.isProgrammatic ? (
        <PlaceholderHelp
          keywordPreview={form.keywordPreview}
          destinationPreview={form.destinationPreview}
          prefix={`${form.namespace}/`}
        />
      ) : null}

      {form.errors.existingLink ? (
        <Box sx={{ mt: 1.5 }}>
          <ExistingLinkNotice
            link={form.errors.existingLink}
            message={form.errors.keyword}
            onOpen={onOpenExisting}
          />
        </Box>
      ) : null}

      {form.errors.general ? (
        <Typography variant="body2" color="error" sx={{ mt: 1.5 }}>
          {form.errors.general}
        </Typography>
      ) : null}

      {organization.readOnly ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          This organization is read-only, so links cannot be created right now.
        </Typography>
      ) : null}

      {stacked ? (
        <Button
          type="submit"
          variant="contained"
          fullWidth
          disabled={!form.canSubmit}
          sx={{ mt: 2 }}
        >
          {submitLabel}
        </Button>
      ) : (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {CREATE_HELP}
        </Typography>
      )}
    </Box>
  )
}
