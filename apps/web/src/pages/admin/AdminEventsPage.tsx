import { AdminLayout } from '../../features/admin/AdminLayout.tsx'
import { AdminEventsView } from '../../features/admin/events/AdminEventsView.tsx'

/** `/_/admin/events`: the audit trail (spec 07 §1). */
export function AdminEventsPage() {
  return (
    <AdminLayout>
      <AdminEventsView />
    </AdminLayout>
  )
}
