import { AdminLayout } from '../../features/admin/AdminLayout.tsx'
import { AdminSettingsView } from '../../features/admin/settings/AdminSettingsView.tsx'

/** `/_/admin/settings`: the organization settings document (spec 06 §2). */
export function AdminSettingsPage() {
  return (
    <AdminLayout>
      <AdminSettingsView />
    </AdminLayout>
  )
}
