import AdminDashboard from '@/components/AdminDashboard'

export const dynamic = 'force-dynamic'

// Middleware already verified sbk_admin_token before reaching this page.
export default function AdminPage() {
  return <AdminDashboard />
}
