import { Navigate, useOutlet } from 'react-router'
import { ADMIN_DEFAULT_PATH, AdminLayout } from '../../features/admin/AdminLayout.tsx'

/**
 * `/_/admin`: the administration area itself (ADR 0002 §7).
 *
 * The area has no screen of its own — it is three tabs — so this renders the
 * frame and hands the member to the first of them. The role gate lives in the
 * frame, so a member who may not be here is told so instead of being sent on.
 */
export function AdminOverviewPage() {
  const outlet = useOutlet()

  return <AdminLayout>{outlet ?? <Navigate to={ADMIN_DEFAULT_PATH} replace />}</AdminLayout>
}
