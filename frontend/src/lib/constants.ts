export const APP_VERSION = '0.1.0';

/** Backend hard-caps list pages; keep the client default in sync with the contract. */
export const DEFAULT_PAGE_SIZE = 20;

export const ROUTES = {
  landing: '/',
  designSystem: '/design-system',
  login: '/login',
  register: '/register',
  verifyEmail: '/verify-email',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  home: '/home',
  explore: '/explore',
  notifications: '/notifications',
  messages: '/messages',
  search: '/search',
  settings: '/settings',
  posts: '/posts',
  profile: '/profile',
  admin: '/admin',
  /**
   * The only page a **moderator** can use: `/admin` (flags) and `/admin/audit`
   * are admin-only (`require_roles(UserRole.ADMIN)`), while the report queue
   * accepts `MODERATOR` and `ADMIN`. Linking a moderator to `/admin` would be a
   * guaranteed 403, so the staff entry point branches on `role`.
   */
  adminReports: '/admin/reports',
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

/** `/profile/{id}` — built in one place so a route rename cannot half-land. */
export function profilePath(userId: number): string {
  return `${ROUTES.profile}/${String(userId)}`;
}

/** `/profile/{id}/gallery` — a user's image gallery, derived from their posts. */
export function profileGalleryPath(userId: number): string {
  return `${profilePath(userId)}/gallery`;
}
