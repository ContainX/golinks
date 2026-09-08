/**
 * Notices a member can close for good (spec 08 §7).
 *
 * A dismissal is stored against the member rather than in the browser, so
 * closing a notice on a laptop also closes it on a phone. The list lives in
 * `preferences.dismissedNotices`, which is a whitelisted preference key
 * (spec 01 §2.5).
 */

import { useMe, usePatchMe } from '../../queries/me.ts'

/** The notice explaining how to make the short host resolve (spec 11 §1, §3). */
export const SHORT_HOST_NOTICE_ID = 'short-host-setup'

export interface DismissibleNotices {
  /** False until `/me` has answered: a notice is never flashed and then hidden. */
  isDismissed: (id: string) => boolean
  /** Records the dismissal. A no-op before `/me` has answered. */
  dismiss: (id: string) => void
}

export function useDismissedNotices(): DismissibleNotices {
  const { data } = useMe()
  const patchMe = usePatchMe()

  const preferences = data?.user.preferences
  const dismissed = preferences?.dismissedNotices ?? []

  return {
    isDismissed: (id) => dismissed.includes(id),
    dismiss: (id) => {
      // The list only grows once `PATCH /me` has answered, so a second click
      // before then would send the same write again.
      if (preferences === undefined || dismissed.includes(id) || patchMe.isPending) {
        return
      }
      // `PATCH /me` replaces the whole preferences document (spec 05 §3), so
      // the other keys are sent back with the one being added.
      patchMe.mutate({ preferences: { ...preferences, dismissedNotices: [...dismissed, id] } })
    },
  }
}
