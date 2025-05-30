import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
} from '@convex-dev/auth/nextjs/server';

const isSignInPage = createRouteMatcher(['/login','/register']);
const isProtectedRoute = createRouteMatcher(['/chat(.*)']);

export default convexAuthNextjsMiddleware(async (request) => {

});

export const config = {
  // The following matcher runs middleware on all routes
  // except static assets.
  matcher: [
    '/',
    '/chat/:id',
    '/login',
    '/register',
    '/((?!.*\\..*|_next).*)',
    '/',
    '/(api|trpc)(.*)',
  ],
};
