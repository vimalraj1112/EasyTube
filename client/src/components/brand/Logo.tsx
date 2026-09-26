import { cn } from '@/lib/utils';

export interface LogoProps {
  className?: string;
  /** Hide the wordmark and render the mark only. */
  markOnly?: boolean;
}

/**
 * EasyTube mark: an original glyph combining a downward flow arrow with a
 * waveform. No third-party brand assets are used.
 */
export function Logo({ className, markOnly = false }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-brand-500 via-brand-600 to-accent-500 shadow-[0_6px_20px_-8px_rgb(117_71_247/0.9)]">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="size-5 text-white"
          focusable="false"
        >
          <path
            d="M12 3.5v10.2m0 0 3.4-3.4M12 13.7 8.6 10.3"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4.5 16.2v1.3a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-1.3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            opacity="0.72"
          />
        </svg>
      </span>
      {!markOnly && (
        <span className="font-display text-[1.05rem] font-semibold tracking-tight text-ink-50">
          Media<span className="text-brand-300">Flow</span>
        </span>
      )}
    </span>
  );
}
