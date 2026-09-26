import { cn } from '@/lib/utils';

export interface StatusPillProps {
  tone: 'success' | 'pending' | 'danger' | 'neutral';
  label: string;
  /** Renders a subtle pulsing dot for in-flight states. */
  pulse?: boolean;
  className?: string;
}

const TONE_STYLES: Record<StatusPillProps['tone'], string> = {
  success: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
  pending: 'border-amber-300/25 bg-amber-300/10 text-amber-100',
  danger: 'border-rose-400/25 bg-rose-400/10 text-rose-200',
  neutral: 'border-ink-100/15 bg-ink-100/5 text-ink-200',
};

const DOT_STYLES: Record<StatusPillProps['tone'], string> = {
  success: 'bg-emerald-400',
  pending: 'bg-amber-300',
  danger: 'bg-rose-400',
  neutral: 'bg-ink-300',
};

export function StatusPill({ tone, label, pulse = false, className }: StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium',
        TONE_STYLES[tone],
        className,
      )}
    >
      <span className="relative grid size-2 place-items-center">
        <span className={cn('size-2 rounded-full', DOT_STYLES[tone])} />
        {pulse && (
          <span
            className={cn('absolute size-2 animate-ping rounded-full opacity-70', DOT_STYLES[tone])}
          />
        )}
      </span>
      {label}
    </span>
  );
}
