import { setupServer } from 'msw/node';

import { handlers } from './handlers';

/**
 * Node-side MSW server. Lifecycle (`listen` / `resetHandlers` / `close`) lives in
 * `vitest.setup.ts`, so every test file shares one server and starts clean.
 */
export const server = setupServer(...handlers);
