/**
 * A settings refusal, rendered beside the field that caused it.
 *
 * The API answers a keyword-space change with the links that stand in the way
 * (spec 06 §2), and those links are the useful part: an admin cannot act on
 * "namespace conflicts" but can act on "go/eng/deploy". So every list the
 * refusal carried is shown, in the same words the directory uses.
 */

import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import type { SettingsConflict, SettingsLinkReference } from './settingsConflicts.ts'

/** The heading each kind of refusal is announced with. */
const CONFLICT_TITLES = {
  namespaceInUse: 'Those namespaces still hold links',
  namespaceConflicts: 'Those namespaces would make existing keywords ambiguous',
  keywordCollisions: 'Two keywords would end up sharing one canonical form',
  prefixFallback: 'Prefix fallback resolution cannot be turned on yet',
  keywordInvalid: 'Some keywords would be left without a canonical form',
  message: 'The change was refused',
} as const

function LinkList({ links }: { links: readonly SettingsLinkReference[] }) {
  return (
    <Box component="ul" sx={{ pl: 2.5, m: 0 }}>
      {links.map((link) => (
        <Typography component="li" variant="body2" key={link.id}>
          {link.fullPath}
        </Typography>
      ))}
    </Box>
  )
}

export interface SettingsConflictAlertProps {
  conflict: SettingsConflict
}

export function SettingsConflictAlert({ conflict }: SettingsConflictAlertProps) {
  return (
    <Alert severity="warning">
      <AlertTitle>{CONFLICT_TITLES[conflict.kind]}</AlertTitle>
      <Typography variant="body2" sx={{ mb: 1 }}>
        {conflict.message}
      </Typography>

      {conflict.kind === 'namespaceInUse' ? (
        <Box component="ul" sx={{ pl: 2.5, m: 0 }}>
          {conflict.namespaces.map((usage) => (
            <Typography component="li" variant="body2" key={usage.namespace}>
              {`${usage.namespace} holds ${usage.linkCount === 1 ? '1 link' : `${usage.linkCount} links`}`}
            </Typography>
          ))}
        </Box>
      ) : null}

      {conflict.kind === 'namespaceConflicts'
        ? conflict.conflicts.map((entry) => (
            <Box key={entry.namespace} sx={{ mb: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {entry.namespace}
              </Typography>
              <LinkList links={entry.links} />
            </Box>
          ))
        : null}

      {conflict.kind === 'keywordCollisions'
        ? conflict.collisions.map((collision) => (
            <Box key={`${collision.namespace}/${collision.keyword}`} sx={{ mb: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {`Canonical form: ${collision.namespace}/${collision.keyword}`}
              </Typography>
              <LinkList links={collision.links} />
            </Box>
          ))
        : null}

      {conflict.kind === 'prefixFallback' ? (
        <>
          {conflict.placeholderViolations.length > 0 ? (
            <Box component="ul" sx={{ pl: 2.5, m: 0, mb: 1 }}>
              {conflict.placeholderViolations.map((link) => (
                <Typography component="li" variant="body2" key={link.id}>
                  {`${link.fullPath}: ${link.message}`}
                </Typography>
              ))}
            </Box>
          ) : null}
          {conflict.prefixConflicts.map((entry) => (
            <Box key={`${entry.namespace}/${entry.prefix}`} sx={{ mb: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {`Prefix: ${entry.namespace}/${entry.prefix}`}
              </Typography>
              <LinkList links={entry.links} />
            </Box>
          ))}
        </>
      ) : null}

      {conflict.kind === 'keywordInvalid' ? (
        <Box component="ul" sx={{ pl: 2.5, m: 0 }}>
          {conflict.links.map((link) => (
            <Typography component="li" variant="body2" key={link.id}>
              {`${link.fullPath}: ${link.message}`}
            </Typography>
          ))}
        </Box>
      ) : null}
    </Alert>
  )
}
