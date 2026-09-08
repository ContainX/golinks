import { AdminLayout } from '../../features/admin/AdminLayout.tsx'
import { AdminUsersView } from '../../features/admin/users/AdminUsersView.tsx'

/** `/_/admin/users`: the organization's members (spec 08 §8). */
export function AdminUsersPage() {
  return (
    <AdminLayout>
      <AdminUsersView />
    </AdminLayout>
  )
}
