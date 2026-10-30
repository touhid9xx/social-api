export const APP_VERSION = '0.1.0';

/** Backend hard-caps list pages; keep the client default in sync with the contract. */
export const DEFAULT_PAGE_SIZE = 20;

export const ROUTES = {
  landing: '/',
  previewColors: '/preview-colors',
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
  admin: '/admin',
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
