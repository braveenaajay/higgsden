import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { api } from '../api';
import { PageTitle } from '../components/shell';
import { Button, Card, EmptyState, SkeletonScreen, StatusBadge } from '../components/ui';

export function DeskPage() {
  const { agencyId } = useParams({ from: '/a/$agencyId/desk' });
  const qc = useQueryClient();
  const conversations = useQuery({
    queryKey: ['desk', agencyId],
    queryFn: () => api.get<{ id: string; merchantName: string; subject: string; status: string }[]>(`/agencies/${agencyId}/desk/conversations`),
  });
  const incidents = useQuery({
    queryKey: ['incidents', agencyId],
    queryFn: () => api.get<{ id: string; title: string; severity: string; status: string }[]>(`/agencies/${agencyId}/desk/incidents`),
  });
  const reply = useMutation({
    mutationFn: (id: string) =>
      api.post(`/agencies/${agencyId}/desk/conversations/${id}/replies`, { body: 'We are looking at this on the dummy staging environment.' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['desk', agencyId] }),
  });
  return (
    <>
      <PageTitle hint="Conversations and incidents. AI drafts are dummy recordings until Claude is connected.">Merchant desk</PageTitle>
      <h2 className="font-display text-lg">Conversations</h2>
      {conversations.isPending ? <SkeletonScreen label="Loading conversations" /> : null}
      <ul className="mt-2 space-y-2">
        {(conversations.data ?? []).map((c) => (
          <Card key={c.id} className="space-y-3 p-4">
            <div>
              <span className="font-semibold">{c.subject}</span>
              <span className="ml-2 text-[14px] text-ink-soft">{c.merchantName}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={c.status} />
              <Button onClick={() => reply.mutate(c.id)} loading={reply.isPending && reply.variables === c.id} loadingLabel="Sending reply">
                Reply
              </Button>
            </div>
          </Card>
        ))}
      </ul>
      {!conversations.isPending && !(conversations.data ?? []).length ? <EmptyState title="No conversations yet" /> : null}
      <h2 className="mt-6 font-display text-lg">Incidents</h2>
      {incidents.isPending ? <SkeletonScreen label="Loading incidents" /> : null}
      <ul className="mt-2 space-y-2">
        {(incidents.data ?? []).map((i) => (
          <li key={i.id} className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-sheet px-4 py-3 ring-1 ring-line">
            <span>
              {i.severity} · {i.title}
            </span>
            <StatusBadge status={i.status} />
          </li>
        ))}
      </ul>
    </>
  );
}
