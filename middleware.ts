import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
} from '@convex-dev/auth/nextjs/server';

const isSignInPage = createRouteMatcher(['/']);
const isProtectedRoute = createRouteMatcher(['/dashboard(.*)']);

export default convexAuthNextjsMiddleware(async (request) => {

});

export const config = {
  // The following matcher runs middleware on all routes
  // except static assets.
  matcher: [
    '/',
    '/chat/:id',
    '/api/:path*',
    '/login',
    '/register',
    '/((?!.*\\..*|_next).*)',
    '/',
    '/(api|trpc)(.*)',
  ],
};
