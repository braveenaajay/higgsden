import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { api, ApiError } from '../api';
import { AppFrame, FetchProgress, Screen } from '../components/shell';
import { Button, Card, Message, SkeletonScreen, StatusBadge } from '../components/ui';
import { ThemeToggle } from '../theme';

export function OperatorPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const signOut = useMutation({
    mutationFn: api.signOut,
    onSuccess: async () => {
      qc.clear();
      await navigate({ to: '/sign-in' });
    },
  });
  const agencies = useQuery({
    queryKey: ['ops-agencies'],
    queryFn: () => api.get<{ id: string; name: string; plan: string; subscriptionState: string; projects: number; teamsConnected: boolean }[]>('/ops/agencies'),
  });
  const support = useQuery({ queryKey: ['ops-support'], queryFn: () => api.get<{ id: string; agencyName: string; subject: string; status: string }[]>('/ops/support') });
  const costs = useQuery({ queryKey: ['ops-costs'], queryFn: () => api.get<{ agencies: { agencyName: string; costCents: number; revenueCents: number; marginPercent: number | null }[]; tiers: { tier: string; costCents: number; revenueCents: number }[] }>('/ops/costs') });
  const capacity = useQuery({ queryKey: ['ops-capacity'], queryFn: () => api.get<{ cells: { id: string; region: string; pods: number; nodes: number }[] }>('/ops/capacity') });

  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/sign-in" />;
  if (me.isPending) {
    return (
      <AppFrame>
        <SkeletonScreen label="Loading operator console" />
      </AppFrame>
    );
  }
  if (me.data && !me.data.user.isOperator) {
    return (
      <AppFrame>
        <Message title="Operator access only." />
      </AppFrame>
    );
  }

  const loadingLists = agencies.isPending || support.isPending || costs.isPending || capacity.isPending;

  return (
    <AppFrame>
      <FetchProgress />
      <header className="den-topbar">
        <p className="px-1 font-display text-lg lg:text-xl">HiggsDEN</p>
        <p className="den-desktop-only text-[13px] font-semibold uppercase tracking-[0.14em] text-ember-dark">Operator</p>
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          <Button tone="ghost" onClick={() => signOut.mutate()} loading={signOut.isPending} loadingLabel="Signing out">
            Sign out
          </Button>
        </div>
      </header>
      <Screen>
        <h1 className="font-display text-[28px] leading-tight lg:text-[40px]">Operator console</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-6 text-ink-soft">Agencies, plans, support, and cell capacity. No stories, discovery, or knowledge.</p>
        {loadingLists ? <SkeletonScreen label="Loading operator data" /> : null}
        <h2 className="mt-6 font-display text-lg lg:text-xl">Agencies</h2>
        <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {(agencies.data ?? []).map((a) => (
            <Card key={a.id} className="p-4 lg:p-5">
              <div className="flex items-center justify-between gap-3">
                <strong>{a.name}</strong>
                <StatusBadge status={a.subscriptionState} />
              </div>
              <p className="mt-1 text-[15px] text-ink-soft">
                {a.plan} · {a.projects} projects{a.teamsConnected ? ' · Teams connected' : ''}
              </p>
            </Card>
          ))}
        </div>
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-lg lg:text-xl">Support</h2>
            <ul className="mt-2 space-y-2 text-[15px]">
              {(support.data ?? []).map((r) => (
                <li key={r.id} className="min-h-12 rounded-2xl bg-sheet px-4 py-3 ring-1 ring-line">
                  {r.agencyName}: {r.subject} ({r.status})
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="font-display text-lg lg:text-xl">Capacity</h2>
            <ul className="mt-2 space-y-2 text-[15px]">
              {(capacity.data?.cells ?? []).map((c) => (
                <li key={c.id} className="min-h-12 rounded-2xl bg-sheet px-4 py-3 ring-1 ring-line">
                  {c.id} {c.region}: pods {c.pods}%, nodes {c.nodes}%
                </li>
              ))}
            </ul>
          </div>
        </div>
        <h2 className="mt-8 font-display text-lg lg:text-xl">Cost vs revenue (dummy CUR)</h2>
        <ul className="mt-2 grid gap-2 text-[15px] lg:grid-cols-2">
          {(costs.data?.agencies ?? []).map((a) => (
            <li key={a.agencyName} className="min-h-12 rounded-2xl bg-sheet px-4 py-3 ring-1 ring-line">
              {a.agencyName}: cost ${(a.costCents / 100).toFixed(0)} / revenue ${(a.revenueCents / 100).toFixed(0)}
              {a.marginPercent != null ? ` · ${a.marginPercent}% margin` : ''}
            </li>
          ))}
        </ul>
      </Screen>
    </AppFrame>
  );
}
