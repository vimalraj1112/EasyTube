import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-6xl flex-col items-center justify-center px-4 text-center sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-300">404</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Page not found</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-400">
        The page you&rsquo;re looking for doesn&rsquo;t exist or has moved.
      </p>
      <Link
        to="/"
        className="mt-8 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-brand-500"
      >
        Back to home
      </Link>
    </div>
  );
}
