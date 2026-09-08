/**
 * The one-line confirmations these screens hand back: a keyword copied, a link
 * created, a link deleted.
 *
 * A single host renders them so that the directory, the drawer on top of it,
 * and the dialogs on top of that all queue into the same place instead of
 * stacking three snackbars in three corners.
 */

import Alert from '@mui/material/Alert'
import Snackbar from '@mui/material/Snackbar'
import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useState } from 'react'

export type NoticeSeverity = 'success' | 'info' | 'error'

export interface Notice {
  message: string
  severity: NoticeSeverity
}

type Notify = (message: string, severity?: NoticeSeverity) => void

const NoticeContext = createContext<Notify>(() => {})

/** Shows a short confirmation. Safe to call outside a provider, where it does nothing. */
export function useNotify(): Notify {
  return useContext(NoticeContext)
}

export interface NoticeProviderProps {
  children: ReactNode
}

const AUTO_HIDE_MS = 5000

export function NoticeProvider({ children }: NoticeProviderProps) {
  const [notice, setNotice] = useState<Notice | null>(null)

  // Stable, so a screen that takes `notify` as a dependency is not re-run every
  // time a notice appears or clears.
  const notify = useCallback<Notify>((message, severity = 'success') => {
    setNotice({ message, severity })
  }, [])

  return (
    <NoticeContext.Provider value={notify}>
      {children}
      <Snackbar
        open={notice !== null}
        autoHideDuration={AUTO_HIDE_MS}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Alert
          severity={notice?.severity ?? 'success'}
          variant="filled"
          onClose={() => setNotice(null)}
          sx={{ width: '100%' }}
        >
          {notice?.message ?? ''}
        </Alert>
      </Snackbar>
    </NoticeContext.Provider>
  )
}
