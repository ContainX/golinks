/**
 * Where a keyword that does not exist lands (ADR 0002 §4, spec 04 §8).
 *
 * The resolver answers a miss with a redirect to
 * `/_/?keyword=<k>&namespace=<ns>`, so the member arrives here having already
 * typed what they wanted. That typed keyword is the one thing this screen does
 * not ask for: it is shown locked, and the only question is where it should
 * point — or whether one of the links that nearly matches was meant instead.
 */

import type { Link } from '@golinks/shared/api'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import SearchOffIcon from '@mui/icons-material/SearchOff'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Fragment } from 'react'
import { browserNavigation } from '../../api/http.ts'
import { useLinkSuggestions } from '../../queries/links.ts'
import { useCreateLinkForm } from './createLinkForm.ts'
import { ExistingLinkNotice } from './ExistingLinkNotice.tsx'
import type { OrganizationContext } from './organization.ts'
import { PlaceholderHelp } from './PlaceholderHelp.tsx'
import { linkAddress, resolverPath } from './paths.ts'

export interface UnknownKeywordScreenProps {
  /** The keyword as the member typed it, from the query string. */
  keyword: string
  /** The namespace the resolver named, or `null` for the default one. */
  namespace: string | null
  organization: OrganizationContext
  /** Back to the directory. */
  onBack: () => void
  /** Opens a link's drawer, after creating one or hitting a collision. */
  onOpenLink: (link: Link) => void
}

export function UnknownKeywordScreen({
  keyword,
  namespace,
  organization,
  onBack,
  onOpenLink,
}: UnknownKeywordScreenProps) {
  const targetNamespace = namespace ?? organization.defaultNamespace
  const displayPath = `${targetNamespace}/${keyword}`

  const form = useCreateLinkForm({
    organization,
    initialKeyword: keyword,
    initialNamespace: targetNamespace,
    onCreated: onOpenLink,
  })

  const suggestions = useLinkSuggestions({
    keyword,
    ...(namespace === null ? {} : { namespace }),
  })

  const similar = suggestions.data?.items ?? []

  function goTo(link: Link) {
    // Leaving the app on purpose: the resolver owns keyword paths and records
    // the visit (spec 04 §1, spec 07).
    browserNavigation.navigate(`/${resolverPath(linkAddress(link), organization.defaultNamespace)}`)
  }

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 720, mx: 'auto' }}>
      <Box sx={{ textAlign: 'center', mb: 3 }}>
        <SearchOffIcon sx={{ fontSize: 44, color: 'text.disabled' }} />
        <Typography variant="h5" component="h1" sx={{ mt: 1 }}>
          {displayPath} doesn&apos;t exist yet
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          Create it now and it works for everyone in your organization, or pick one of the similar
          links below.
        </Typography>
      </Box>

      <Paper
        variant="outlined"
        component="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (form.canSubmit) {
            void form.submit()
          }
        }}
        sx={{ p: 2.5 }}
      >
        <Box sx={{ mb: 2 }}>
          <Chip label={displayPath} sx={{ fontFamily: 'monospace' }} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Keyword as you typed it
          </Typography>
          {form.errors.keyword && !form.errors.existingLink ? (
            <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
              {form.errors.keyword}
            </Typography>
          ) : null}
        </Box>

        <TextField
          fullWidth
          label="Destination"
          placeholder="Paste the destination URL"
          value={form.destination}
          onChange={(event) => form.setDestination(event.target.value)}
          error={form.errors.destination !== undefined}
          helperText={form.errors.destination}
          autoFocus
        />

        {form.isProgrammatic ? (
          <PlaceholderHelp
            keywordPreview={form.keywordPreview}
            destinationPreview={form.destinationPreview}
            prefix={`${targetNamespace}/`}
          />
        ) : null}

        {form.errors.existingLink ? (
          <Box sx={{ mt: 2 }}>
            <ExistingLinkNotice
              link={form.errors.existingLink}
              message={form.errors.keyword}
              onOpen={onOpenLink}
            />
          </Box>
        ) : null}

        {form.errors.general ? (
          <Typography variant="body2" color="error" sx={{ mt: 2 }}>
            {form.errors.general}
          </Typography>
        ) : null}

        <Stack direction="row" spacing={1} sx={{ mt: 2.5, justifyContent: 'space-between' }}>
          <Button onClick={onBack}>Back to directory</Button>
          <Button type="submit" variant="contained" disabled={!form.canSubmit}>
            Create {displayPath}
          </Button>
        </Stack>
      </Paper>

      {similar.length === 0 ? null : (
        <Box sx={{ mt: 4 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            Did you mean
          </Typography>
          <Paper variant="outlined">
            <List disablePadding>
              {similar.map((link, index) => (
                <Fragment key={link.id}>
                  {index === 0 ? null : <Divider component="li" />}
                  <ListItem
                    secondaryAction={
                      <Button
                        size="small"
                        startIcon={<ArrowForwardIcon />}
                        onClick={() => goTo(link)}
                      >
                        Go
                      </Button>
                    }
                  >
                    <ListItemText
                      primary={link.fullPath}
                      secondary={link.destination}
                      slotProps={{
                        primary: { sx: { fontFamily: 'monospace' } },
                        secondary: { sx: { wordBreak: 'break-all' } },
                      }}
                    />
                  </ListItem>
                </Fragment>
              ))}
            </List>
          </Paper>
        </Box>
      )}
    </Box>
  )
}
