import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api';
import { PageTitle } from '../components/shell';
import { Button, Card, EmptyState, Field, SkeletonScreen, StatusBadge, TextArea, TextInput } from '../components/ui';

export function SupportPage() {
  const { agencyId } = useParams({ from: '/a/$agencyId/support' });
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['support', agencyId],
    queryFn: () => api.get<{ id: string; subject: string; status: string }[]>(`/agencies/${agencyId}/support`),
  });
  const [subject, setSubject] = useState('Need help with the dummy cell');
  const [body, setBody] = useState('This is a platform support request, not a merchant ticket.');
  const create = useMutation({
    mutationFn: () => api.post(`/agencies/${agencyId}/support`, { subject, body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['support', agencyId] }),
  });
  return (
    <>
      <PageTitle hint="Ask HiggsDEN operators for help. Merchant chat lives under Desk.">Platform support</PageTitle>
      <Card className="space-y-3 p-4">
        <Field label="Subject" htmlFor="support-subject">
          <TextInput id="support-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Details" htmlFor="support-details">
          <TextArea id="support-details" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <Button onClick={() => create.mutate()} loading={create.isPending} loadingLabel="Opening request">
          Open request
        </Button>
      </Card>
      {list.isPending ? <SkeletonScreen label="Loading support requests" /> : null}
      <ul className="mt-4 space-y-2">
        {(list.data ?? []).map((r) => (
          <li key={r.id} className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-sheet px-4 py-3 ring-1 ring-line">
            <span>{r.subject}</span>
            <StatusBadge status={r.status} />
          </li>
        ))}
      </ul>
      {!list.isPending && !(list.data ?? []).length ? (
        <div className="mt-4">
          <EmptyState title="No support requests yet">Open a request if the dummy cell or billing looks wrong.</EmptyState>
        </div>
      ) : null}
    </>
  );
}
