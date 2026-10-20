import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { api } from '../api';
import { PageTitle } from '../components/shell';
import { Button, Card, EmptyState, Field, Select, SkeletonScreen } from '../components/ui';

interface GitHubPayload {
  mode: string;
  installUrl: string;
  installation: { accountLogin: string; permissionLevel: number } | null;
  repositories: { id: string; fullName: string; projectId: string | null }[];
}

export function GitHubPage() {
  const { agencyId } = useParams({ from: '/a/$agencyId/github' });
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['github', agencyId], queryFn: () => api.get<GitHubPayload>(`/agencies/${agencyId}/github`) });
  const workspace = useQuery({ queryKey: ['workspace', agencyId], queryFn: () => api.workspace(agencyId) });
  const attach = useMutation({
    mutationFn: ({ repositoryId, projectId }: { repositoryId: string; projectId: string }) =>
      api.post(`/agencies/${agencyId}/github/repositories/${repositoryId}/attach`, { projectId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['github', agencyId] }),
  });
  if (data.isPending) return <SkeletonScreen label="Loading GitHub" />;
  if (!data.data) return <SkeletonScreen label="Loading GitHub" />;
  const projects = (workspace.data?.clients ?? []).flatMap((c) => c.projects.map((p) => ({ id: p.id, label: `${p.key} ${p.name}` })));
  return (
    <>
      <PageTitle hint={`Mode: ${data.data.mode}. No GitHub App is registered yet; install uses the local fake.`}>GitHub</PageTitle>
      {data.data.installation ? (
        <p className="text-[15px]">
          Installed on <strong>{data.data.installation.accountLogin}</strong> at permission level {data.data.installation.permissionLevel}.
        </p>
      ) : (
        <a className="inline-flex min-h-12 items-center font-semibold text-ember-dark" href={data.data.installUrl}>
          Install the dummy GitHub App
        </a>
      )}
      <ul className="mt-4 space-y-3">
        {data.data.repositories.map((r) => (
          <Card key={r.id} className="space-y-3 p-4">
            <span className="font-mono text-[15px]">{r.fullName}</span>
            {r.projectId ? (
              <p className="text-[14px] text-ink-soft">Attached</p>
            ) : (
              <Field label="Attach to project" htmlFor={`repo-${r.id}`}>
                <Select
                  id={`repo-${r.id}`}
                  defaultValue=""
                  disabled={attach.isPending || workspace.isPending}
                  onChange={(e) => {
                    if (e.target.value) attach.mutate({ repositoryId: r.id, projectId: e.target.value });
                  }}
                >
                  <option value="">Choose a project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </Card>
        ))}
      </ul>
      {!data.data.repositories.length ? (
        <div className="mt-4">
          <EmptyState title="No repositories yet">Install the dummy App to see repositories.</EmptyState>
        </div>
      ) : null}
      <div className="mt-4">
        <Button tone="secondary" onClick={() => qc.invalidateQueries()} loading={data.isFetching} loadingLabel="Refreshing">
          Refresh
        </Button>
      </div>
    </>
  );
}
