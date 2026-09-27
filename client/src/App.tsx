import { Route, Routes } from 'react-router-dom';

import { AuthProvider } from '@/auth/AuthProvider';
import { RedirectIfAuthenticated, RequireAuth } from '@/auth/RequireAuth';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { AccountPage } from '@/pages/AccountPage';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { RegisterPage } from '@/pages/RegisterPage';

/**
 * Route table. `/`, `/login`, `/register` and `/account` exist as of Phase 11;
 * each later phase adds its own entry here.
 *
 * `AuthProvider` sits inside the router because `RequireAuth` and the header
 * both read it, and its bootstrap has to run before the first protected route
 * decides whether to redirect.
 */
export function App() {
  return (
    <AuthProvider>
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route
              path="/login"
              element={
                <RedirectIfAuthenticated>
                  <LoginPage />
                </RedirectIfAuthenticated>
              }
            />
            <Route
              path="/register"
              element={
                <RedirectIfAuthenticated>
                  <RegisterPage />
                </RedirectIfAuthenticated>
              }
            />
            <Route
              path="/account"
              element={
                <RequireAuth>
                  <AccountPage />
                </RequireAuth>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
        <footer className="border-t border-ink-100/10 px-4 py-6 sm:px-6">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 text-xs text-ink-500 sm:flex-row">
            <p>&copy; {new Date().getFullYear()} EasyTube. Your media. Your formats. Your flow.</p>
            <p>Only download content you own or have permission to download.</p>
          </div>
        </footer>
      </div>
    </AuthProvider>
  );
}
