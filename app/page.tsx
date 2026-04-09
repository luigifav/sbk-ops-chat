import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth'
import LoginScreen from '@/components/LoginScreen'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: { admin?: string }
}

export default async function Home({ searchParams }: PageProps) {
  const cookieStore = cookies()
  const isAdmin = searchParams.admin === '1'

  if (isAdmin) {
    const adminToken = cookieStore.get('sbk_admin_token')?.value
    if (adminToken && process.env.ADMIN_PASSWORD && process.env.AUTH_SECRET) {
      const isValid = await verifyToken(
        adminToken,
        process.env.ADMIN_PASSWORD,
        process.env.AUTH_SECRET
      )
      if (isValid) redirect('/admin')
    }
  } else {
    const authToken = cookieStore.get('sbk_auth_token')?.value
    if (authToken && process.env.ACCESS_PASSWORD && process.env.AUTH_SECRET) {
      const isValid = await verifyToken(
        authToken,
        process.env.ACCESS_PASSWORD,
        process.env.AUTH_SECRET
      )
      if (isValid) redirect('/chat')
    }
  }

  return <LoginScreen isAdmin={isAdmin} />
}
