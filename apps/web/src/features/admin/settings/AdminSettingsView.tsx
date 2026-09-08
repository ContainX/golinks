/**
 * The Settings tab: the whole organization settings document as one form
 * (spec 06 §2, spec 08 §8).
 *
 * `PUT /admin/settings` replaces the document rather than merging into it, so
 * the form holds every field, starts from what `GET` answered, and sends the
 * lot back. Four of those fields describe the keyword space, and changing one
 * can be refused by the links that already exist; those refusals are rendered
 * beside the field that caused them (see `settingsConflicts.ts`) instead of as
 * one message at the top.
 */

import type { OrganizationSettings } from '@golinks/shared/settings'
import AddIcon from '@mui/icons-material/Add'
import CancelIcon from '@mui/icons-material/Cancel'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { validationFields } from '../../../api/errors.ts'
import { useAdminSettings, usePutAdminSettings } from '../../../queries/admin.ts'
import { SettingsConflictAlert } from './SettingsConflictAlert.tsx'
import { readSettingsConflict } from './settingsConflicts.ts'

/** One titled block of the form. */
function Section({ title, description, children }: SectionProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        {title}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {description}
      </Typography>
      <Stack spacing={2}>{children}</Stack>
    </Paper>
  )
}

interface SectionProps {
  title: string
  description: string
  children: ReactNode
}

/** A list of short values an admin adds to and removes from, shown as chips. */
function ChipListField({ label, placeholder, values, onChange, error }: ChipListFieldProps) {
  const [draft, setDraft] = useState('')

  function add(): void {
    const value = draft.trim()
    if (value === '') {
      return
    }
    onChange([...values, value])
    setDraft('')
  }

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {values.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            None yet.
          </Typography>
        ) : null}
        {values.map((value, index) => (
          <Chip
            // biome-ignore lint/suspicious/noArrayIndexKey: the document stores an ordered list of plain strings that may repeat until the API refuses them, so a position is the only identity an entry has.
            key={`${value}-${index}`}
            label={value}
            onDelete={() => onChange(values.filter((_item, at) => at !== index))}
            deleteIcon={<CancelIcon aria-label={`Remove ${value}`} />}
          />
        ))}
      </Stack>
      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          label={label}
          placeholder={placeholder}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // Enter inside a form would otherwise save the document.
              event.preventDefault()
              add()
            }
          }}
          error={error !== undefined}
          helperText={error}
          sx={{ width: 320 }}
        />
        <Button startIcon={<AddIcon />} onClick={add}>
          Add
        </Button>
      </Stack>
    </Stack>
  )
}

interface ChipListFieldProps {
  label: string
  placeholder: string
  values: readonly string[]
  onChange: (values: string[]) => void
  error?: string | undefined
}

/** A color as `#rrggbb`, with the color itself shown beside the value. */
function ColorField({ label, value, onChange, error }: ColorFieldProps) {
  return (
    <TextField
      label={label}
      value={value ?? ''}
      placeholder="#1f4b99"
      onChange={(event) => onChange(event.target.value.trim() === '' ? null : event.target.value)}
      error={error !== undefined}
      helperText={error ?? 'Written as #rrggbb. Leave empty for the default palette.'}
      sx={{ width: 320 }}
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <Box
                aria-hidden
                sx={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: value ?? 'transparent',
                }}
              />
            </InputAdornment>
          ),
        },
      }}
    />
  )
}

interface ColorFieldProps {
  label: string
  value: string | null
  onChange: (value: string | null) => void
  error?: string | undefined
}

/** An optional URL: the empty field means "not set", which the document stores as null. */
function nullableUrl(value: string): string | null {
  return value.trim() === '' ? null : value
}

export function AdminSettingsView() {
  const settings = useAdminSettings()
  const save = usePutAdminSettings()
  const [form, setForm] = useState<OrganizationSettings | null>(null)
  const [saved, setSaved] = useState(false)

  // The document is read once into the form. A later refetch does not overwrite
  // it, because the admin may be halfway through an edit; a save replaces it
  // with what was stored.
  useEffect(() => {
    setForm((current) => (current === null && settings.data ? settings.data : current))
  }, [settings.data])

  if (settings.isError) {
    return <Alert severity="error">{settings.error.message}</Alert>
  }

  if (form === null) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <CircularProgress size={20} aria-label="Loading settings" />
        <Typography variant="body2">Loading the organization's settings…</Typography>
      </Stack>
    )
  }

  const fieldErrors = validationFields(save.error) ?? {}
  const conflict = readSettingsConflict(save.error)

  function update(change: Partial<OrganizationSettings>): void {
    setForm((current) => (current === null ? current : { ...current, ...change }))
  }

  /** The first message the API attached to a field, if it refused one. */
  function fieldError(path: string): string | undefined {
    return fieldErrors[path]
  }

  /** Messages the API attached to entries of a list, as one line. */
  function listError(prefix: string): string | undefined {
    const messages = Object.entries(fieldErrors)
      .filter(([path]) => path.startsWith(`${prefix}[`))
      .map(([path, message]) => `${path}: ${message}`)
    return messages.length === 0 ? undefined : messages.join(' ')
  }

  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault()
        setSaved(false)
        save.mutate(form, {
          onSuccess: (stored) => {
            setForm(stored)
            setSaved(true)
          },
        })
      }}
    >
      <Stack spacing={2}>
        <Section
          title="Namespaces"
          description="The default namespace is what a bare keyword resolves under; every other namespace is reached by naming it first."
        >
          <TextField
            label="Default namespace"
            value={form.defaultNamespace}
            onChange={(event) => update({ defaultNamespace: event.target.value })}
            error={fieldError('defaultNamespace') !== undefined}
            helperText={
              fieldError('defaultNamespace') ??
              'Renaming it moves every link in it to the new name.'
            }
            sx={{ width: 320 }}
          />
          <ChipListField
            label="Add namespace"
            placeholder="eng"
            values={form.namespaces}
            onChange={(namespaces) => update({ namespaces })}
            error={listError('namespaces')}
          />
          {conflict?.field === 'namespaces' ? <SettingsConflictAlert conflict={conflict} /> : null}
        </Section>

        <Section
          title="Keywords"
          description="How a typed keyword is normalized, what shapes are allowed, and how a keyword that is not an exact match resolves."
        >
          <TextField
            label="Allowed pattern"
            value={form.keywords.allowedPattern}
            onChange={(event) =>
              update({ keywords: { ...form.keywords, allowedPattern: event.target.value } })
            }
            error={fieldError('keywords.allowedPattern') !== undefined}
            helperText={
              fieldError('keywords.allowedPattern') ??
              'A regular expression. It applies to new and renamed keywords only.'
            }
            fullWidth
          />
          <FormControlLabel
            control={
              <Switch
                checked={form.keywords.punctuationSensitive}
                onChange={(event) =>
                  update({
                    keywords: { ...form.keywords, punctuationSensitive: event.target.checked },
                  })
                }
              />
            }
            label="Punctuation sensitive"
          />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Turning this off makes go/meeting-notes and go/meetingnotes the same keyword, and
            recomputes every existing link the moment it is saved.
          </Typography>
          <TextField
            select
            label="Resolution mode"
            value={form.keywords.resolutionMode}
            onChange={(event) =>
              update({
                keywords: {
                  ...form.keywords,
                  resolutionMode: event.target
                    .value as OrganizationSettings['keywords']['resolutionMode'],
                },
              })
            }
            helperText={
              fieldError('keywords.resolutionMode') ??
              'Prefix fallback lets go/example/anything reach the programmatic link go/example/%s.'
            }
            sx={{ width: 320 }}
          >
            <MenuItem value="standard">Standard</MenuItem>
            <MenuItem value="prefixFallback">Prefix fallback</MenuItem>
          </TextField>
          {conflict?.field === 'keywords' ? <SettingsConflictAlert conflict={conflict} /> : null}
        </Section>

        <Section
          title="Access"
          description="Who may change a link, whether the organization accepts writes at all, and which addresses receive the admin role at sign-in."
        >
          <TextField
            select
            label="Edit mode"
            value={form.editMode}
            onChange={(event) =>
              update({ editMode: event.target.value as OrganizationSettings['editMode'] })
            }
            helperText="Who may change a link's destination."
            sx={{ width: 320 }}
          >
            <MenuItem value="ownersAndAdmins">Owners and admins</MenuItem>
            <MenuItem value="anyMember">Any member</MenuItem>
          </TextField>
          <FormControlLabel
            control={
              <Switch
                checked={form.readOnly}
                onChange={(event) => update({ readOnly: event.target.checked })}
              />
            }
            label="Read-only"
          />
          <ChipListField
            label="Add admin email"
            placeholder="ops@acme.com"
            values={form.admins}
            onChange={(admins) => update({ admins })}
            error={listError('admins')}
          />
        </Section>

        <Section
          title="Banner"
          description="A line shown to every member, for a migration or an outage."
        >
          {form.banner === null ? (
            <Box>
              <Button
                startIcon={<AddIcon />}
                onClick={() => update({ banner: { text: '', url: null, level: 'info' } })}
              >
                Add banner
              </Button>
            </Box>
          ) : (
            <>
              <TextField
                label="Banner text"
                value={form.banner.text}
                onChange={(event) =>
                  update({
                    banner:
                      form.banner === null ? null : { ...form.banner, text: event.target.value },
                  })
                }
                error={fieldError('banner.text') !== undefined}
                helperText={fieldError('banner.text')}
                fullWidth
              />
              <TextField
                label="Banner URL"
                value={form.banner.url ?? ''}
                onChange={(event) =>
                  update({
                    banner:
                      form.banner === null
                        ? null
                        : { ...form.banner, url: nullableUrl(event.target.value) },
                  })
                }
                error={fieldError('banner.url') !== undefined}
                helperText={fieldError('banner.url') ?? 'Optional. Makes the banner a link.'}
                fullWidth
              />
              <TextField
                select
                label="Banner level"
                value={form.banner.level}
                onChange={(event) =>
                  update({
                    banner:
                      form.banner === null
                        ? null
                        : {
                            ...form.banner,
                            level: event.target.value as NonNullable<
                              OrganizationSettings['banner']
                            >['level'],
                          },
                  })
                }
                sx={{ width: 320 }}
              >
                <MenuItem value="info">Info</MenuItem>
                <MenuItem value="warning">Warning</MenuItem>
              </TextField>
              <Box>
                <Button color="inherit" onClick={() => update({ banner: null })}>
                  Clear banner
                </Button>
              </Box>
            </>
          )}
        </Section>

        <Section
          title="Branding"
          description="The title, logo, and colors every member's app is rendered with."
        >
          <TextField
            label="Title"
            value={form.branding.title}
            onChange={(event) =>
              update({ branding: { ...form.branding, title: event.target.value } })
            }
            error={fieldError('branding.title') !== undefined}
            helperText={fieldError('branding.title')}
            sx={{ width: 320 }}
          />
          <TextField
            label="Logo URL"
            value={form.branding.logoUrl ?? ''}
            onChange={(event) =>
              update({ branding: { ...form.branding, logoUrl: nullableUrl(event.target.value) } })
            }
            error={fieldError('branding.logoUrl') !== undefined}
            helperText={fieldError('branding.logoUrl')}
            fullWidth
          />
          <TextField
            label="Favicon URL"
            value={form.branding.faviconUrl ?? ''}
            onChange={(event) =>
              update({
                branding: { ...form.branding, faviconUrl: nullableUrl(event.target.value) },
              })
            }
            error={fieldError('branding.faviconUrl') !== undefined}
            helperText={fieldError('branding.faviconUrl')}
            fullWidth
          />
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <ColorField
              label="Primary color"
              value={form.branding.primaryColor}
              onChange={(primaryColor) => update({ branding: { ...form.branding, primaryColor } })}
              error={fieldError('branding.primaryColor')}
            />
            <ColorField
              label="Secondary color"
              value={form.branding.secondaryColor}
              onChange={(secondaryColor) =>
                update({ branding: { ...form.branding, secondaryColor } })
              }
              error={fieldError('branding.secondaryColor')}
            />
          </Stack>
        </Section>

        <Section
          title="Navigation links"
          description="Entries shown beside the app's own navigation. Admin-only entries are hidden from members."
        >
          {form.navigationLinks.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              None yet.
            </Typography>
          ) : null}
          {form.navigationLinks.map((navigationLink, index) => (
            <Stack
              // biome-ignore lint/suspicious/noArrayIndexKey: navigation links are an ordered list in the document with no ids of their own, and editing one in place must keep the row it is being typed in.
              key={`navigation-link-${index}`}
              direction={{ xs: 'column', md: 'row' }}
              spacing={1}
              sx={{ alignItems: { md: 'center' } }}
            >
              <TextField
                size="small"
                label={`Text ${index + 1}`}
                value={navigationLink.text}
                onChange={(event) =>
                  update({
                    navigationLinks: form.navigationLinks.map((entry, at) =>
                      at === index ? { ...entry, text: event.target.value } : entry,
                    ),
                  })
                }
                error={fieldError(`navigationLinks[${index}].text`) !== undefined}
                helperText={fieldError(`navigationLinks[${index}].text`)}
                sx={{ width: 220 }}
              />
              <TextField
                size="small"
                label={`URL ${index + 1}`}
                value={navigationLink.url}
                onChange={(event) =>
                  update({
                    navigationLinks: form.navigationLinks.map((entry, at) =>
                      at === index ? { ...entry, url: event.target.value } : entry,
                    ),
                  })
                }
                error={fieldError(`navigationLinks[${index}].url`) !== undefined}
                helperText={fieldError(`navigationLinks[${index}].url`)}
                sx={{ flexGrow: 1 }}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={navigationLink.adminOnly}
                    onChange={(event) =>
                      update({
                        navigationLinks: form.navigationLinks.map((entry, at) =>
                          at === index ? { ...entry, adminOnly: event.target.checked } : entry,
                        ),
                      })
                    }
                  />
                }
                label={`Admins only ${index + 1}`}
              />
              <IconButton
                aria-label={`Remove navigation link ${index + 1}`}
                onClick={() =>
                  update({
                    navigationLinks: form.navigationLinks.filter((_entry, at) => at !== index),
                  })
                }
              >
                <DeleteOutlinedIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Box>
            <Button
              startIcon={<AddIcon />}
              onClick={() =>
                update({
                  navigationLinks: [
                    ...form.navigationLinks,
                    { text: '', url: '', adminOnly: false },
                  ],
                })
              }
            >
              Add navigation link
            </Button>
          </Box>
        </Section>

        {conflict?.field === 'settings' ? <SettingsConflictAlert conflict={conflict} /> : null}
        {save.isError && conflict === null && Object.keys(fieldErrors).length === 0 ? (
          <Alert severity="error">{save.error.message}</Alert>
        ) : null}
        {Object.keys(fieldErrors).length > 0 ? (
          <Alert severity="error">{save.error?.message}</Alert>
        ) : null}

        <Divider />

        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Button type="submit" variant="contained" disabled={save.isPending}>
            Save settings
          </Button>
          <Button
            color="inherit"
            disabled={save.isPending || settings.data === undefined}
            onClick={() => setForm(settings.data ?? null)}
          >
            Reset
          </Button>
          {save.isPending ? <CircularProgress size={20} aria-label="Saving settings" /> : null}
        </Stack>
      </Stack>

      <Snackbar
        open={saved}
        autoHideDuration={6000}
        onClose={() => setSaved(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setSaved(false)}>
          Settings saved.
        </Alert>
      </Snackbar>
    </Box>
  )
}
