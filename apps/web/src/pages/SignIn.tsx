import { ROLE_LABELS } from '@higgsden/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api } from '../api';
import { AppFrame, FetchProgress, Screen } from '../components/shell';
import { Badge, Card, Message, SkeletonScreen, Spinner } from '../components/ui';
import { ThemeToggle } from '../theme';

export function SignIn() {
  const users = useQuery({ queryKey: ['demo-users'], queryFn: api.demoUsers });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signIn = useMutation({
    mutationFn: api.demoSignIn,
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: '/' });
    },
  });

  if (users.isPending) {
    return (
      <AppFrame variant="auth">
        <SkeletonScreen label="Loading demo accounts" />
      </AppFrame>
    );
  }
  if (users.error) {
    return (
      <AppFrame variant="auth">
        <Message title="Demo sign-in is not available">Real sign-in arrives with Better Auth.</Message>
      </AppFrame>
    );
  }

  return (
    <AppFrame variant="auth">
      <aside className="den-auth-brand">
        <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[var(--color-nav-muted)]">HiggsDEN</p>
        <p className="font-display text-5xl leading-tight">The den for agency delivery.</p>
        <p className="max-w-sm text-[16px] leading-7 text-[var(--color-nav-text)]">
          One workspace for members, discovery, hosting, and merchant desk — without mixing Agency knowledge.
        </p>
      </aside>
      <FetchProgress />
      <Screen>
        <div className="mb-4 flex justify-end">
          <ThemeToggle />
        </div>
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-ember-dark">HiggsDEN</p>
        <h1 className="mt-2 font-display text-[32px] leading-tight lg:text-[40px]">Sign in as a demo user</h1>
        <p className="mt-2 max-w-xl text-[15px] leading-6 text-ink-soft">
          Development only. All people, Agencies, and stores are fictional. Each user sees only what their role and Client
          assignments allow.
        </p>
        <Card className="mt-6 overflow-hidden lg:max-w-3xl">
          {users.data.map((u) => {
            const pending = signIn.isPending && signIn.variables === u.id;
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => signIn.mutate(u.id)}
                disabled={signIn.isPending}
                aria-busy={pending || undefined}
                className="flex min-h-16 w-full items-center justify-between gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 active:bg-paper lg:px-5 lg:hover:bg-paper disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block font-semibold">{u.name}</span>
                  <span className="block truncate text-[14px] text-ink-soft">{u.email}</span>
                </span>
                <span className="flex max-w-[46%] flex-wrap justify-end gap-1.5 lg:max-w-none">
                  {pending ? <Spinner label="Signing in" /> : null}
                  {u.isOperator ? <Badge tone="amber">Operator</Badge> : null}
                  {u.memberships.map((m) => (
                    <Badge key={m.agencyName} tone={m.role === 'owner' || m.role === 'admin' ? 'violet' : 'neutral'}>
                      {m.agencyName} · {ROLE_LABELS[m.role]}
                    </Badge>
                  ))}
                </span>
              </button>
            );
          })}
        </Card>
        {signIn.error ? (
          <p className="mt-3 text-[15px] font-medium text-clay" role="alert">
            {signIn.error.message}
          </p>
        ) : null}
      </Screen>
    </AppFrame>
  );
}
