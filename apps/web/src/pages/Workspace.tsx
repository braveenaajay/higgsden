import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api';
import { PageTitle } from '../components/shell';
import { Button, Card, EmptyState, Field, Message, SkeletonScreen, StatusBadge, TextInput } from '../components/ui';

export function Workspace() {
  const { agencyId } = useParams({ from: '/a/$agencyId/' });
  const qc = useQueryClient();
  const workspace = useQuery({ queryKey: ['workspace', agencyId], queryFn: () => api.workspace(agencyId) });
  const [clientName, setClientName] = useState('New Client');
  const createClient = useMutation({
    mutationFn: () => api.post(`/agencies/${agencyId}/clients`, { name: clientName, summary: 'Created from the dummy workspace.' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace', agencyId] }),
  });

  if (workspace.isPending) return <SkeletonScreen label="Loading workspace" />;
  if (workspace.error) return <Message title="Could not load this workspace" />;

  const { agency, clients, seesAllClients } = workspace.data;

  return (
    <>
      <PageTitle
        kicker={agency.planCode}
        hint={seesAllClients ? 'You can see every Client in this Agency.' : `You are assigned to ${clients.length} Client${clients.length === 1 ? '' : 's'}.`}
      >
        {agency.name}
      </PageTitle>
      <div className="mb-4 flex items-center gap-2">
        <StatusBadge status={agency.subscriptionState} />
      </div>

      <Card className="space-y-3 p-4 lg:max-w-md lg:p-5">
        <Field label="New Client" htmlFor="client-name" hint="Name the brand this Agency is delivering for.">
          <TextInput
            id="client-name"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            autoComplete="organization"
          />
        </Field>
        <Button onClick={() => createClient.mutate()} loading={createClient.isPending} loadingLabel="Creating Client">
          Create Client
        </Button>
        {createClient.error ? (
          <p className="text-[15px] font-medium text-clay" role="alert">
            {createClient.error.message}
          </p>
        ) : null}
      </Card>

      {clients.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No Clients yet">An Admin needs to assign you to a Client before its projects appear here.</EmptyState>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {clients.map((client) => (
            <Card key={client.id} className="overflow-hidden">
              <div className="px-4 pt-4 lg:px-5 lg:pt-5">
                <h2 className="font-display text-xl">{client.name}</h2>
                <p className="mt-1 text-[15px] leading-6 text-ink-soft">{client.summary}</p>
              </div>
              <ul className="mt-3">
                {client.projects.map((p) => (
                  <li key={p.id} className="border-t border-line">
                    <Link
                      to="/a/$agencyId/p/$projectId"
                      params={{ agencyId, projectId: p.id }}
                      className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 active:bg-paper"
                    >
                      <span>
                        <span className="mr-2 font-mono text-[12px] text-ink-soft">{p.key}</span>
                        <span className="font-semibold">{p.name}</span>
                      </span>
                      <span className="shrink-0 text-[13px] text-ink-soft">
                        {p.storyCount} {p.storyCount === 1 ? 'story' : 'stories'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
