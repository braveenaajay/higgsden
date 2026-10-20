import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import type { ReactNode } from 'react';

export function AppFrame({
  children,
  variant = 'app',
  withNav = false,
}: {
  children: ReactNode;
  variant?: 'app' | 'narrow' | 'auth';
  withNav?: boolean;
}) {
  const extras = [
    variant === 'narrow' ? 'den-app-narrow' : '',
    variant === 'auth' ? 'den-app-auth' : '',
    withNav ? 'den-app-nav' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="den-desk">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className={`den-app ${extras}`}>{children}</div>
    </div>
  );
}

/** @deprecated Use AppFrame. */
export const PhoneFrame = AppFrame;

export function FetchProgress() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  if (!fetching && !mutating) return null;
  return <div className="den-progress" role="progressbar" aria-label="Loading" />;
}

export function Screen({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1} className="den-screen">
      <div className="den-screen-canvas">{children}</div>
    </main>
  );
}

export function PageTitle({ kicker, children, hint }: { kicker?: string; children: ReactNode; hint?: string }) {
  return (
    <header className="mb-4 lg:mb-6">
      {kicker ? <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-ember-dark">{kicker}</p> : null}
      <h1 className="mt-1 font-display text-[28px] leading-tight tracking-tight lg:text-[40px]">{children}</h1>
      {hint ? <p className="mt-2 max-w-3xl text-[15px] leading-6 text-ink-soft lg:text-[16px]">{hint}</p> : null}
    </header>
  );
}
