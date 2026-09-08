import type { RouteObject } from 'react-router'
import { AdminEventsPage } from '../pages/admin/AdminEventsPage.tsx'
import { AdminOverviewPage } from '../pages/admin/AdminOverviewPage.tsx'
import { AdminSettingsPage } from '../pages/admin/AdminSettingsPage.tsx'
import { AdminUsersPage } from '../pages/admin/AdminUsersPage.tsx'
import { DirectoryPage } from '../pages/DirectoryPage.tsx'
import { NotFoundPage } from '../pages/NotFoundPage.tsx'
import { SignInPage } from '../pages/SignInPage.tsx'
import { TransferPage } from '../pages/TransferPage.tsx'
import { AppShell } from './AppShell.tsx'
import { RouteErrorScreen } from './RouteErrorScreen.tsx'

/**
 * The client route table.
 *
 * Route ownership is fixed by spec 04 §1: the web app owns `/` and `/_/**`,
 * a couple of fixed files are served directly, and *every other path is a
 * keyword* belonging to the resolver. That is why there is no catch-all at the
 * root of this table and why the only splat lives under `/_/`. A route such as
 * `path: '*'` at the top level would make the app claim `/handbook`, and any
 * client-side navigation to a keyword would then render the app instead of
 * redirecting. Keywords are reached by leaving the app: a full page load, so
 * the request reaches the server that owns it.
 *
 * Paths under `/_/` that the API owns — `/_/api/**`, `/_/auth/**`, `/_/health`,
 * `/_/opensearch.xml`, `/_/assets/**` — are likewise absent here. They are
 * never navigated to with the router; they are fetched, or reached with a full
 * page load, and in development the Vite proxy forwards them to the API.
 */
export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteErrorScreen />,
    children: [
      // The directory (spec 08 §3).
      { index: true, element: <DirectoryPage /> },
      {
        // Application routes live under `/_/` so that no keyword can collide
        // with one. A route without an element just renders its children.
        path: '_',
        children: [
          // Where the resolver sends a miss: `/_/?keyword=...&namespace=...`
          // (spec 04 §8). Same screen as `/`, arriving with the form pre-filled.
          { index: true, element: <DirectoryPage /> },
          // Sign-in (spec 08 §2). The API's `/_/auth/login` endpoint hands the
          // browser here when a provider must be chosen or an error shown, and
          // sign-out lands here with `?signedOut=1` (spec 02 §2, §4).
          { path: 'login', element: <SignInPage /> },
          // A link's own URL: the directory with that link's drawer open (ADR 0002).
          { path: 'links/:id', element: <DirectoryPage /> },
          // Accepting an ownership transfer (spec 08 §6, spec 05 §2.4).
          { path: 'transfer/:token', element: <TransferPage /> },
          {
            path: 'admin',
            children: [
              { index: true, element: <AdminOverviewPage /> },
              { path: 'users', element: <AdminUsersPage /> },
              { path: 'settings', element: <AdminSettingsPage /> },
              { path: 'events', element: <AdminEventsPage /> },
            ],
          },
          // Anything else under `/_/`. Scoped to this branch on purpose: a
          // splat at the root would swallow keyword paths.
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]
