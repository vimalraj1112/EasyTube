import { Route, Routes } from 'react-router-dom';

import { SiteHeader } from '@/components/layout/SiteHeader';
import { HomePage } from '@/pages/HomePage';
import { NotFoundPage } from '@/pages/NotFoundPage';

/**
 * Route table. Only `/` is implemented in Phase 1; each subsequent phase adds
 * its own entry here.
 */
export function App() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
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
  );
}
