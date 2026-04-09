import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from '@/lib/auth'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow auth endpoints to pass through unauthenticated
  if (
    pathname === '/api/auth' ||
    pathname === '/api/admin/auth'
  ) {
    return NextResponse.next()
  }

  const accessPassword = process.env.ACCESS_PASSWORD!
  const adminPassword = process.env.ADMIN_PASSWORD!
  const authSecret = process.env.AUTH_SECRET!

  // Admin routes: /admin/* and /api/admin/*
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    const adminToken = request.cookies.get('sbk_admin_token')?.value

    if (!adminToken) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const url = request.nextUrl.clone()
      url.pathname = '/'
      url.search = '?admin=1'
      return NextResponse.redirect(url)
    }

    const isValid = await verifyToken(adminToken, adminPassword, authSecret)
    if (!isValid) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const url = request.nextUrl.clone()
      url.pathname = '/'
      url.search = '?admin=1'
      return NextResponse.redirect(url)
    }

    return NextResponse.next()
  }

  // Operator chat routes: /chat/* and /api/chat/*
  if (pathname.startsWith('/chat') || pathname.startsWith('/api/chat')) {
    const authToken = request.cookies.get('sbk_auth_token')?.value

    if (!authToken) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const url = request.nextUrl.clone()
      url.pathname = '/'
      url.search = ''
      return NextResponse.redirect(url)
    }

    const isValid = await verifyToken(authToken, accessPassword, authSecret)
    if (!isValid) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const url = request.nextUrl.clone()
      url.pathname = '/'
      url.search = ''
      return NextResponse.redirect(url)
    }

    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
