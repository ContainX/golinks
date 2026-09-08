/**
 * The member's color scheme, from `preferences.colorScheme` (ADR 0002 §10).
 *
 * Two things are kept in step. Material UI holds the choice in its own state
 * and mirrors it to `localStorage`, which is what makes the scheme survive a
 * reload without waiting for a request; `/me` holds it in the member's
 * preferences, which is what makes it follow them to another browser. The
 * stored preference is the one that wins: when it arrives, or when it changes,
 * it is applied to Material UI.
 *
 * It is applied *when it changes*, not whenever the two disagree. A member who
 * picks dark sees dark immediately, while the `PATCH /me` that records it is
 * still in flight; a rule that reconciled on every render would snap the page
 * back to the old scheme in between.
 */

import type { UserPreferences } from '@golinks/shared/api'
import { useColorScheme } from '@mui/material/styles'
import { useEffect, useRef } from 'react'
import { useMe, usePatchMe } from '../../queries/me.ts'

/** `system`, `light`, or `dark` (spec 01 §2.5). */
export type ColorSchemePreference = NonNullable<UserPreferences['colorScheme']>

/** The choices offered in the user menu, in the order they are shown. */
export const COLOR_SCHEME_PREFERENCES = ['system', 'light', 'dark'] as const

/** What a member who has never chosen gets: whatever their device asks for. */
export const DEFAULT_COLOR_SCHEME_PREFERENCE: ColorSchemePreference = 'system'

export interface ColorSchemeControl {
  /** The member's stored choice, or `system` while none has been made. */
  preference: ColorSchemePreference
  /** Applies a choice at once and records it against the member. */
  choose: (next: ColorSchemePreference) => void
  /** True while `PATCH /me` is in flight, so the control can say so. */
  isSaving: boolean
}

/**
 * Reads the stored color scheme, applies it, and offers a way to change it.
 *
 * Call once, high in the tree: the effect it installs is what applies the
 * member's choice to the whole app.
 */
export function useColorSchemePreference(): ColorSchemeControl {
  const { data } = useMe()
  const patchMe = usePatchMe()
  const { setMode } = useColorScheme()

  const preferences = data?.user.preferences
  const stored = preferences?.colorScheme
  const applied = useRef<ColorSchemePreference | undefined>(undefined)

  useEffect(() => {
    if (stored === undefined || applied.current === stored) {
      return
    }
    applied.current = stored
    setMode(stored)
  }, [stored, setMode])

  return {
    preference: stored ?? DEFAULT_COLOR_SCHEME_PREFERENCE,
    isSaving: patchMe.isPending,
    choose: (next) => {
      setMode(next)
      if (preferences === undefined) {
        return
      }
      // `PATCH /me` replaces the whole preferences document, so everything
      // already stored is sent back alongside the key being changed.
      patchMe.mutate(
        { preferences: { ...preferences, colorScheme: next } },
        {
          // The stored preference is the truth. If it could not be written,
          // put the app back where the member's account says it should be.
          onError: () => setMode(stored ?? DEFAULT_COLOR_SCHEME_PREFERENCE),
        },
      )
    },
  }
}
