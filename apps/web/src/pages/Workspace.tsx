import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api';
import { PageTitle } from '../components/shell';
import { Button, Card, EmptyState, Field, Message, SkeletonScreen, StatusBadge, TextArea, TextInput } from '../components/ui';

function keyFromName(name: string) {
  const letters = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10);
  return letters.length >= 2 ? letters : 'PRJ';
}

export function Workspace() {
  const { agencyId } = useParams({ from: '/a/$agencyId/' });
  const qc = useQueryClient();
  const workspace = useQuery({ queryKey: ['workspace', agencyId], queryFn: () => api.workspace(agencyId) });
  const [clientName, setClientName] = useState('');
  const [clientSummary, setClientSummary] = useState('');
  const createClient = useMutation({
    mutationFn: () => api.post(`/agencies/${agencyId}/clients`, { name: clientName.trim(), summary: clientSummary.trim() }),
    onSuccess: () => {
      setClientName('');
      setClientSummary('');
      void qc.invalidateQueries({ queryKey: ['workspace', agencyId] });
    },
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

      {seesAllClients ? (
        <Card className="space-y-3 p-4 lg:max-w-md lg:p-5">
          <Field label="New Client" htmlFor="client-name" hint="Name the brand this Agency is delivering for.">
            <TextInput id="client-name" value={clientName} onChange={(e) => setClientName(e.target.value)} autoComplete="organization" />
          </Field>
          <Field label="Summary" htmlFor="client-summary" optional>
            <TextArea id="client-summary" rows={3} value={clientSummary} onChange={(e) => setClientSummary(e.target.value)} />
          </Field>
          <Button onClick={() => createClient.mutate()} loading={createClient.isPending} loadingLabel="Creating Client" disabled={!clientName.trim()}>
            Create Client
          </Button>
          {createClient.error ? (
            <p className="text-[15px] font-medium text-clay" role="alert">
              {createClient.error.message}
            </p>
          ) : null}
        </Card>
      ) : null}

      {clients.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No Clients yet">Create a Client to start a project and backlog.</EmptyState>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {clients.map((client) => (
            <ClientCard key={client.id} agencyId={agencyId} client={client} canManage={seesAllClients} />
          ))}
        </div>
      )}
    </>
  );
}

function ClientCard({
  agencyId,
  client,
  canManage,
}: {
  agencyId: string;
  client: { id: string; name: string; summary: string; projects: { id: string; key: string; name: string; storyCount: number }[] };
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [projectName, setProjectName] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const createProject = useMutation({
    mutationFn: () =>
      api.post(`/agencies/${agencyId}/projects`, {
        clientId: client.id,
        name: projectName.trim(),
        key: (projectKey || keyFromName(projectName)).trim().toUpperCase(),
        summary: '',
      }),
    onSuccess: () => {
      setProjectName('');
      setProjectKey('');
      void qc.invalidateQueries({ queryKey: ['workspace', agencyId] });
    },
  });
  const removeClient = useMutation({
    mutationFn: () => api.delete(`/agencies/${agencyId}/clients/${client.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace', agencyId] }),
  });

  return (
    <Card className="overflow-hidden">
      <div className="px-4 pt-4 lg:px-5 lg:pt-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-xl">{client.name}</h2>
          {canManage ? (
            <Button tone="ghost" onClick={() => removeClient.mutate()} loading={removeClient.isPending} loadingLabel="Removing">
              Remove
            </Button>
          ) : null}
        </div>
        {client.summary ? <p className="mt-1 text-[15px] leading-6 text-ink-soft">{client.summary}</p> : null}
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
      {canManage ? (
        <div className="space-y-3 border-t border-line px-4 py-4 lg:px-5">
          <Field label="New project" htmlFor={`project-name-${client.id}`}>
            <TextInput
              id={`project-name-${client.id}`}
              value={projectName}
              onChange={(e) => {
                setProjectName(e.target.value);
                if (!projectKey) setProjectKey(keyFromName(e.target.value));
              }}
            />
          </Field>
          <Field label="Key" htmlFor={`project-key-${client.id}`} hint="2–10 letters or digits. Used on story keys such as ACME-1.">
            <TextInput
              id={`project-key-${client.id}`}
              value={projectKey}
              onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
              autoCapitalize="characters"
            />
          </Field>
          <Button onClick={() => createProject.mutate()} loading={createProject.isPending} loadingLabel="Creating project" disabled={!projectName.trim()}>
            Create project
          </Button>
          {createProject.error ? (
            <p className="text-[15px] font-medium text-clay" role="alert">
              {createProject.error.message}
            </p>
          ) : null}
          {removeClient.error ? (
            <p className="text-[15px] font-medium text-clay" role="alert">
              {removeClient.error.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
