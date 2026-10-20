import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'violet';

const TONES: Record<Tone, string> = {
  neutral: 'badge-neutral',
  blue: 'badge-blue',
  green: 'badge-green',
  amber: 'badge-amber',
  red: 'badge-red',
  violet: 'badge-violet',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex min-h-8 items-center rounded-full px-3 text-[13px] font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  accepted: 'green',
  converted: 'violet',
  verified: 'green',
  done: 'green',
  active: 'green',
  succeeded: 'green',
  ready: 'blue',
  in_progress: 'blue',
  reviewed: 'blue',
  in_review: 'amber',
  trialing: 'amber',
  proposed: 'amber',
  past_due: 'red',
  rejected: 'red',
  canceled: 'red',
  failed: 'red',
  superseded: 'neutral',
  stale: 'neutral',
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{status.replaceAll('_', ' ')}</Badge>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[22px] bg-sheet shadow-[0_1px_0_rgba(26,22,18,0.06)] ring-1 ring-line ${className}`}>{children}</div>;
}

export function Message({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-5 py-16 text-center">
      <h2 className="font-display text-2xl">{title}</h2>
      {children ? <div className="mt-3 text-[15px] leading-6 text-ink-soft">{children}</div> : null}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="status" aria-live="polite">
      <svg className="den-spin h-5 w-5" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
        <path d="M10 2a8 8 0 0 1 8 8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <span className="text-[15px] font-medium">{label}</span>
    </span>
  );
}

export function Button({
  children,
  onClick,
  type = 'button',
  disabled,
  loading,
  loadingLabel,
  tone = 'primary',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingLabel?: string;
  tone?: 'primary' | 'secondary' | 'ghost';
}) {
  const busy = Boolean(loading || disabled);
  const styles = {
    primary: 'bg-action text-action-fg active:brightness-90',
    secondary: 'bg-sheet text-ink ring-1 ring-line active:bg-paper',
    ghost: 'bg-transparent text-ink',
  }[tone];
  return (
    <button
      {...rest}
      type={type}
      onClick={onClick}
      disabled={busy}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-2xl px-4 text-[16px] font-semibold transition active:scale-[0.98] disabled:opacity-55 ${tone === 'ghost' ? '' : 'w-full lg:w-auto lg:min-w-48'} ${styles} ${rest.className ?? ''}`}
    >
      {loading ? <Spinner label={loadingLabel ?? String(children)} /> : children}
    </button>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-[15px] font-semibold text-ink">
        {label}
        {optional ? <span className="ml-2 font-medium text-ink-soft">Optional</span> : null}
      </label>
      {hint ? <p className="text-[13px] leading-5 text-ink-soft">{hint}</p> : null}
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-[14px] font-medium text-clay" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const control =
  'min-h-12 w-full rounded-2xl border border-line bg-sheet px-4 text-[16px] text-ink placeholder:text-ink-soft/70';

export function TextInput({ errorId, ...props }: InputHTMLAttributes<HTMLInputElement> & { errorId?: string }) {
  return <input {...props} aria-invalid={Boolean(errorId) || undefined} aria-describedby={errorId} className={`${control} ${props.className ?? ''}`} />;
}

export function TextArea({ errorId, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { errorId?: string }) {
  return <textarea {...props} aria-invalid={Boolean(errorId) || undefined} aria-describedby={errorId} className={`${control} py-3 ${props.className ?? ''}`} />;
}

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${control} ${props.className ?? ''}`}>
      {children}
    </select>
  );
}

/** @deprecated Use TextInput. Kept so older pages compile while they migrate. */
export const inputClass = control;

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`den-skeleton rounded-xl ${className}`} aria-hidden="true" />;
}

export function SkeletonScreen({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="grid gap-3 p-5" role="status" aria-live="polite" aria-label={label}>
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-5/6" />
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Card className="p-6 text-center">
      <h2 className="font-display text-xl">{title}</h2>
      {children ? <p className="mt-2 text-[15px] leading-6 text-ink-soft">{children}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </Card>
  );
}
