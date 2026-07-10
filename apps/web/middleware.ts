import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'ifn_session';

/**
 * Corte rápido de navegación: sin cookie de sesión → /login.
 * La validación real de la sesión siempre la hace la API.
 */
export function middleware(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const isLogin = request.nextUrl.pathname.startsWith('/login');

  if (!hasSession && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  if (hasSession && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
