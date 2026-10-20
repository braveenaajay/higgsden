import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { api } from '../api';
import { PageTitle } from '../components/shell';
import { Button, Card, EmptyState, SkeletonScreen, StatusBadge } from '../components/ui';

interface BillingPayload {
  plan: { code: string; name: string; seatCap: number; clientCap: number; monthlyPriceCents: number };
  plans: { code: string; name: string; monthlyPriceCents: number }[];
  subscriptionState: string;
  trialEndsAt: string | null;
  seats: { used: number; cap: number };
  clients: { used: number; cap: number };
  hosting: { period: string; spendCents: number; capCents: number; percent: number };
  invoices: { id: string; period: string; status: string; totalCents: number }[];
  provider: string;
}

export function Billing() {
  const { agencyId } = useParams({ from: '/a/$agencyId/billing' });
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['billing', agencyId], queryFn: () => api.get<BillingPayload>(`/agencies/${agencyId}/billing`) });
  const checkout = useMutation({
    mutationFn: (planCode: string) => api.post<{ url: string }>(`/agencies/${agencyId}/billing/checkout`, { planCode }),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
  });

  if (data.isPending) return <SkeletonScreen label="Loading billing" />;
  if (!data.data) return <SkeletonScreen label="Loading billing" />;
  const d = data.data;
  return (
    <>
      <PageTitle hint={`Provider: ${d.provider}. Stripe is a local fake until a test key is set.`}>Billing</PageTitle>
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg">{d.plan.name}</h2>
          <StatusBadge status={d.subscriptionState} />
        </div>
        <p className="mt-2 text-[15px] leading-6 text-ink-soft">
          Seats {d.seats.used}/{d.seats.cap} · Clients {d.clients.used}/{d.clients.cap} · Hosting {d.hosting.percent}% of cap in{' '}
          {d.hosting.period}
        </p>
      </Card>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {d.plans.map((p) => (
          <Card key={p.code} className="p-4">
            <h3 className="font-semibold">{p.name}</h3>
            <p className="mt-1 text-[15px] text-ink-soft">${(p.monthlyPriceCents / 100).toFixed(0)} / month</p>
            <div className="mt-3">
              <Button onClick={() => checkout.mutate(p.code)} loading={checkout.isPending && checkout.variables === p.code}>
                Subscribe (dummy checkout)
              </Button>
            </div>
          </Card>
        ))}
      </div>
      {d.invoices.length ? (
        <ul className="mt-5 space-y-2 text-[15px]">
          {d.invoices.map((i) => (
            <li key={i.id} className="min-h-12 rounded-2xl bg-sheet px-4 py-3 ring-1 ring-line">
              {i.period} · {i.status} · ${(i.totalCents / 100).toFixed(2)}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-5">
          <EmptyState title="No invoices yet" />
        </div>
      )}
      {checkout.error ? (
        <p className="mt-3 text-[15px] font-medium text-clay" role="alert">
          {checkout.error.message}
        </p>
      ) : null}
      <div className="mt-4">
        <Button tone="secondary" onClick={() => qc.invalidateQueries()} loading={data.isFetching} loadingLabel="Refreshing">
          Refresh
        </Button>
      </div>
    </>
  );
}
