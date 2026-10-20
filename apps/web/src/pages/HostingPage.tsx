import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { api } from '../api';
import { PageTitle } from '../components/shell';
import { Button, Card, SkeletonScreen } from '../components/ui';

interface HostingPayload {
  cell: { id: string; region: string; status: string; pods: { used: number; max: number } } | null;
  period: string;
  spendCents: number;
  capCents: number;
  percent: number;
  capReached: boolean;
  tiers: { code: string; name: string; minReplicas: number; maxReplicas: number }[];
  environments: { id: string; name: string; projectKey: string; currentReplicas: number; pinnedMaxReplicas: number | null; scaledToZero: boolean }[];
}

export function HostingPage() {
  const { agencyId } = useParams({ from: '/a/$agencyId/hosting' });
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['hosting', agencyId], queryFn: () => api.get<HostingPayload>(`/agencies/${agencyId}/hosting`) });
  const simulate = useMutation({
    mutationFn: () => api.post(`/agencies/${agencyId}/hosting/simulate`, { requestsPerSecond: 180, hours: 1 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hosting', agencyId] }),
  });
  if (data.isPending) return <SkeletonScreen label="Loading hosting" />;
  if (!data.data) return <SkeletonScreen label="Loading hosting" />;
  const d = data.data;
  return (
    <>
      <PageTitle hint={`Dummy cell ${d.cell?.id ?? 'none'} in ${d.cell?.region ?? 'n/a'}. Spend ${d.percent}% of cap for ${d.period}. Reaching the cap pins replica maximums; it does not take running replicas away.`}>
        Shared hosting
      </PageTitle>
      {d.capReached ? (
        <p className="mb-3 text-[15px] font-medium text-clay" role="alert">
          Spend cap reached. Scale-up is stopped.
        </p>
      ) : null}
      <Button onClick={() => simulate.mutate()} loading={simulate.isPending} loadingLabel="Simulating load">
        Simulate one hour of load
      </Button>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {d.tiers.map((t) => (
          <Card key={t.code} className="p-4">
            <h3 className="font-semibold">{t.name}</h3>
            <p className="mt-1 text-[15px] text-ink-soft">
              {t.minReplicas}–{t.maxReplicas} replicas
            </p>
          </Card>
        ))}
      </div>
      <ul className="mt-4 space-y-2">
        {d.environments.map((e) => (
          <li key={e.id} className="min-h-12 rounded-2xl bg-sheet px-4 py-3 text-[15px] ring-1 ring-line">
            {e.projectKey} {e.name}: {e.currentReplicas} replicas
            {e.pinnedMaxReplicas != null ? ` (pinned at ${e.pinnedMaxReplicas})` : ''}
            {e.scaledToZero ? ' · scaled to zero' : ''}
          </li>
        ))}
      </ul>
    </>
  );
}
