import type { ProjectDetail } from '@higgsden/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { api, ApiError } from '../api';
import { Badge, Button, Card, EmptyState, Field, Message, SkeletonScreen, StatusBadge, TextInput } from '../components/ui';

const TABS = ['Discovery', 'Backlog', 'Decisions', 'Knowledge', 'Delivery', 'Provisioning', 'AI', 'Insights', 'Activity'] as const;
type Tab = (typeof TABS)[number];

export function ProjectPage() {
  const { agencyId, projectId } = useParams({ from: '/a/$agencyId/p/$projectId' });
  const [tab, setTab] = useState<Tab>('Discovery');
  const detail = useQuery({ queryKey: ['project', agencyId, projectId], queryFn: () => api.project(agencyId, projectId) });

  if (detail.isPending) return <SkeletonScreen label="Loading project" />;
  if (detail.error instanceof ApiError && detail.error.status === 404) {
    return <Message title="Project not found">It does not exist, or it belongs to a Client you are not assigned to.</Message>;
  }
  if (detail.error) return <Message title="Could not load this project" />;

  const d = detail.data;

  return (
    <>
      <Link
        to="/a/$agencyId"
        params={{ agencyId }}
        activeOptions={{ exact: true }}
        className="inline-flex min-h-12 items-center text-[15px] font-semibold text-ember-dark"
      >
        ← {d.project.clientName}
      </Link>
      <p className="mt-1 font-mono text-[13px] text-ink-soft">{d.project.key}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-[28px] leading-tight">{d.project.name}</h1>
        <StatusBadge status={d.project.status} />
      </div>
      <p className="mt-2 text-[15px] leading-6 text-ink-soft">{d.project.summary}</p>

      <details className="mt-3">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-[15px] font-semibold text-ink-soft">
          Your permissions here
          <span aria-hidden="true">▾</span>
        </summary>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {d.allowedActions.map((a) => (
            <Badge key={a}>{a}</Badge>
          ))}
        </div>
      </details>

      <nav className="sticky top-0 z-10 -mx-4 mt-3 flex min-h-14 items-center gap-2 overflow-x-auto overscroll-x-contain bg-paper px-4 py-1 lg:static lg:mx-0 lg:flex-wrap lg:overflow-visible lg:bg-transparent lg:px-0" aria-label="Project sections">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? 'page' : undefined}
            className={`min-h-12 min-w-12 shrink-0 snap-start rounded-full px-4 text-[15px] font-semibold ${
              tab === t ? 'bg-ink text-sheet' : 'bg-sheet text-ink-soft ring-1 ring-line'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <section className="mt-5">
        {tab === 'Discovery' ? <Discovery d={d} agencyId={agencyId} projectId={projectId} /> : null}
        {tab === 'Backlog' ? <Backlog d={d} agencyId={agencyId} projectId={projectId} /> : null}
        {tab === 'Decisions' ? <Decisions d={d} /> : null}
        {tab === 'Knowledge' ? <Knowledge d={d} /> : null}
        {tab === 'Delivery' ? <Delivery agencyId={agencyId} projectId={projectId} /> : null}
        {tab === 'Provisioning' ? <Provisioning agencyId={agencyId} projectId={projectId} /> : null}
        {tab === 'AI' ? <AiTab agencyId={agencyId} projectId={projectId} /> : null}
        {tab === 'Insights' ? <Insights agencyId={agencyId} projectId={projectId} /> : null}
        {tab === 'Activity' ? <Activity d={d} /> : null}
      </section>
    </>
  );
}

function Discovery({ d, agencyId, projectId }: { d: ProjectDetail; agencyId: string; projectId: string }) {
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: (action: string) => api.post(`/agencies/${agencyId}/projects/${projectId}/discovery/actions/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', agencyId, projectId] }),
  });
  const convert = useMutation({
    mutationFn: (requirementIds: string[]) =>
      api.post(`/agencies/${agencyId}/projects/${projectId}/discovery/requirements/convert`, { requirementIds, newEpicTitle: 'Converted from discovery' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', agencyId, projectId] }),
  });
  if (!d.discovery) return <EmptyState title="Discovery has not started" />;
  const { discovery } = d;
  const convertible = discovery.requirements.filter((r) => r.status === 'accepted').map((r) => r.id);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px]">Version {discovery.version}</span>
        <StatusBadge status={discovery.status} />
      </div>
      <div className="grid gap-2 lg:flex lg:flex-wrap">
        {discovery.status === 'draft' ? (
          <Button onClick={() => act.mutate('submit')} loading={act.isPending && act.variables === 'submit'}>
            Send for review
          </Button>
        ) : null}
        {discovery.status === 'in_review' ? (
          <>
            <Button onClick={() => act.mutate('accept')} loading={act.isPending && act.variables === 'accept'}>
              Accept
            </Button>
            <Button tone="secondary" onClick={() => act.mutate('return')} loading={act.isPending && act.variables === 'return'}>
              Return to draft
            </Button>
          </>
        ) : null}
        {convertible.length ? (
          <Button onClick={() => convert.mutate(convertible)} loading={convert.isPending}>
            Convert accepted requirements
          </Button>
        ) : null}
      </div>
      {discovery.recommendation ? (
        <Card className="p-4">
          <h3 className="text-[15px] font-semibold">Recommendation</h3>
          <p className="mt-1 text-[15px] leading-6 text-ink-soft">{discovery.recommendation}</p>
        </Card>
      ) : null}

      <h3 className="font-display text-lg">KPIs</h3>
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {discovery.kpis.map((k) => (
          <Card key={k.id} className="p-4">
            <p className="font-semibold">{k.name}</p>
            <p className="mt-1 text-[13px] uppercase tracking-wide text-ink-soft">{k.category}</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-[15px]">
              <div>
                <dt className="text-[13px] text-ink-soft">Baseline</dt>
                <dd className="tabular-nums">{k.baseline ? `${k.baseline} ${k.unit}` : '—'}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-ink-soft">Target</dt>
                <dd className="tabular-nums">{k.target ? `${k.target} ${k.unit}` : '—'}</dd>
              </div>
            </dl>
            <p className="mt-2 text-[13px] text-ink-soft">{k.source}</p>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <h3 className="font-semibold">Requirements</h3>
        <ul className="mt-3 space-y-3">
          {discovery.requirements.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3">
              <span>
                {r.statement}
                <span className="mt-1 block text-[13px] text-ink-soft">
                  {r.priority} · {r.type.replace('_', '-')}
                </span>
              </span>
              <StatusBadge status={r.status} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Backlog({ d, agencyId, projectId }: { d: ProjectDetail; agencyId: string; projectId: string }) {
  const qc = useQueryClient();
  const ready = useMutation({
    mutationFn: (storyId: string) => api.patch(`/agencies/${agencyId}/projects/${projectId}/stories/${storyId}`, { status: 'ready' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', agencyId, projectId] }),
  });
  if (d.epics.length === 0) {
    return <EmptyState title="No stories yet">Convert accepted requirements to start the backlog.</EmptyState>;
  }
  const requirementById = new Map(d.discovery?.requirements.map((r) => [r.id, r]) ?? []);
  const decisionById = new Map(d.decisions.map((x) => [x.id, x]));
  return (
    <div className="space-y-4">
      {d.epics.map((epic) => (
        <Card key={epic.id} className="p-4">
          <h3 className="font-display text-lg">{epic.title}</h3>
          {epic.outcome ? <p className="text-[15px] text-ink-soft">{epic.outcome}</p> : null}
          <ul className="mt-3 divide-y divide-line">
            {epic.stories.map((story) => (
              <li key={story.id} className="py-3">
                <div className="flex flex-col gap-2">
                  <span>
                    <span className="mr-2 font-mono text-[12px] text-ink-soft">{story.key}</span>
                    <span className="font-semibold">{story.title}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={story.status} />
                    {story.status === 'proposed' ? (
                      <Button onClick={() => ready.mutate(story.id)} loading={ready.isPending && ready.variables === story.id}>
                        Mark ready
                      </Button>
                    ) : null}
                  </span>
                </div>
                {ready.error && ready.variables === story.id ? (
                  <p className="mt-1 text-[14px] font-medium text-clay" role="alert">
                    {ready.error.message}
                  </p>
                ) : null}
                <div className="mt-2 space-y-1 text-[13px] text-ink-soft">
                  {story.requirementId ? <p>Requirement: {requirementById.get(story.requirementId)?.statement}</p> : null}
                  {story.decisionId ? <p>Decision: {decisionById.get(story.decisionId)?.title}</p> : null}
                </div>
                {story.acceptanceCriteria.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px]">
                    {story.acceptanceCriteria.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[14px] text-ember-dark">No acceptance criteria. This story cannot move to ready.</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function Decisions({ d }: { d: ProjectDetail }) {
  if (d.decisions.length === 0) return <EmptyState title="No architecture decisions yet" />;
  return (
    <div className="space-y-3">
      {d.decisions.map((x) => (
        <Card key={x.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-semibold">{x.title}</h3>
            <StatusBadge status={x.status} />
          </div>
          <p className="mt-1 text-[15px] leading-6 text-ink-soft">{x.decision}</p>
        </Card>
      ))}
    </div>
  );
}

function Knowledge({ d }: { d: ProjectDetail }) {
  if (d.knowledge.length === 0) return <EmptyState title="No knowledge notes yet" />;
  return (
    <div className="space-y-3">
      {d.knowledge.map((k) => (
        <Card key={k.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-semibold">{k.title}</h3>
            <StatusBadge status={k.verificationState} />
          </div>
          <p className="mt-1 text-[15px] leading-6 text-ink-soft">{k.body}</p>
        </Card>
      ))}
    </div>
  );
}

function Delivery({ agencyId, projectId }: { agencyId: string; projectId: string }) {
  const qc = useQueryClient();
  const data = useQuery({
    queryKey: ['delivery', agencyId, projectId],
    queryFn: () =>
      api.get<{
        deliveryType: string | null;
        environments: { id: string; name: string; currentVersion: string | null; currentReplicas: number }[];
        deployments: { id: string; version: string; status: string; environmentId: string }[];
        previews: { id: string; name: string; previewUrl: string }[];
        builds: { id: string; commitSha: string; status: string }[];
      }>(`/agencies/${agencyId}/projects/${projectId}/delivery`),
  });
  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/agencies/${agencyId}/projects/${projectId}/delivery/deployments/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery', agencyId, projectId] }),
  });
  const request = useMutation({
    mutationFn: (version: string) => api.post(`/agencies/${agencyId}/projects/${projectId}/delivery/deployments`, { version }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['delivery', agencyId, projectId] }),
  });
  if (data.isPending) return <SkeletonScreen label="Loading delivery" />;
  if (!data.data) return <EmptyState title="Delivery is not available" />;
  const d = data.data;
  return (
    <div className="space-y-3">
      <p className="text-[15px] text-ink-soft">Delivery type: {d.deliveryType ?? 'unset'}. Pipelines, themes, and Argo sync use local fakes.</p>
      {d.environments.map((e) => (
        <Card key={e.id} className="p-4">
          <strong className="capitalize">{e.name}</strong>
          <p className="mt-1 text-[15px] text-ink-soft">
            {e.currentReplicas} replicas · {e.currentVersion?.slice(0, 12) ?? 'no version'}
          </p>
          {e.currentVersion && e.name !== 'production' ? (
            <div className="mt-3">
              <Button onClick={() => request.mutate(e.currentVersion!)} loading={request.isPending}>
                Request production
              </Button>
            </div>
          ) : null}
        </Card>
      ))}
      {d.previews.map((p) => (
        <p key={p.id} className="text-[15px]">
          Preview {p.name}: {p.previewUrl}
        </p>
      ))}
      {d.deployments.map((dep) => (
        <div key={dep.id} className="flex min-h-12 items-center justify-between gap-3">
          <span>
            {dep.version.slice(0, 12)} <StatusBadge status={dep.status} />
          </span>
          {dep.status === 'pending_approval' ? (
            <Button onClick={() => approve.mutate(dep.id)} loading={approve.isPending && approve.variables === dep.id}>
              Approve
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Provisioning({ agencyId, projectId }: { agencyId: string; projectId: string }) {
  const qc = useQueryClient();
  const data = useQuery({
    queryKey: ['provision', agencyId, projectId],
    queryFn: () =>
      api.get<{ resources: { id: string; kind: string; name: string; status: string }[]; dummy: boolean }>(
        `/agencies/${agencyId}/projects/${projectId}/provisioning`,
      ),
  });
  const run = useMutation({
    mutationFn: () => api.post(`/agencies/${agencyId}/projects/${projectId}/provisioning`, { environment: 'staging' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['provision', agencyId, projectId] }),
  });
  return (
    <div className="space-y-3">
      <p className="text-[15px] text-ink-soft">Crossplane claims are dummy AWS resources until the hosting account is connected.</p>
      <Button onClick={() => run.mutate()} loading={run.isPending} loadingLabel="Provisioning">
        Provision dummy staging
      </Button>
      {data.isPending ? <SkeletonScreen label="Loading resources" /> : null}
      <ul className="space-y-2 text-[15px]">
        {(data.data?.resources ?? []).map((r) => (
          <li key={r.id} className="min-h-12 rounded-2xl bg-sheet px-4 py-3 ring-1 ring-line">
            {r.kind} {r.name} · {r.status}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AiTab({ agencyId, projectId }: { agencyId: string; projectId: string }) {
  const [q, setQ] = useState('gift message');
  const search = useQuery({
    queryKey: ['ai-search', agencyId, projectId, q],
    queryFn: () => api.get<{ results: { scope: string; title: string; snippet: string }[]; mode: string }>(`/agencies/${agencyId}/projects/${projectId}/ai/search?q=${encodeURIComponent(q)}`),
    enabled: q.length > 1,
  });
  const run = useMutation({
    mutationFn: () => api.post<{ text: string; mode: string; proposals: { id: string; title: string }[] }>(`/agencies/${agencyId}/projects/${projectId}/ai/skills/plan`, { prompt: q }),
  });
  return (
    <div className="space-y-4">
      <Field label="Search agency + platform knowledge" htmlFor="ai-search" hint="Results stay inside this Agency plus curated platform notes.">
        <TextInput id="ai-search" type="search" enterKeyHint="search" value={q} onChange={(e) => setQ(e.target.value)} />
      </Field>
      {search.isFetching ? <SkeletonScreen label="Searching knowledge" /> : null}
      <ul className="space-y-2">
        {(search.data?.results ?? []).map((r, i) => (
          <li key={i} className="rounded-2xl bg-sheet p-4 ring-1 ring-line">
            <Badge>{r.scope}</Badge> <strong>{r.title}</strong>
            <p className="mt-1 text-[15px] text-ink-soft">{r.snippet}</p>
          </li>
        ))}
      </ul>
      <Button onClick={() => run.mutate()} loading={run.isPending} loadingLabel="Running skill">
        Run plan skill (dummy Claude)
      </Button>
      {run.data ? (
        <Card className="p-4">
          <p>Model mode: {run.data.mode}</p>
          <p className="mt-2 text-[15px] leading-6">{run.data.text}</p>
        </Card>
      ) : null}
    </div>
  );
}

function Insights({ agencyId, projectId }: { agencyId: string; projectId: string }) {
  const data = useQuery({
    queryKey: ['insights', agencyId, projectId],
    queryFn: () =>
      api.get<{
        dora: Record<string, { value: number | null; unit: string; evidence: string }>;
        blocked: { subject: string; conclusion: string; evidence: string[] }[];
        readiness: { subject: string; conclusion: string; level: string }[];
      }>(`/agencies/${agencyId}/projects/${projectId}/insights`),
  });
  if (data.isPending) return <SkeletonScreen label="Loading insights" />;
  if (!data.data) return <EmptyState title="Insights are not available" />;
  return (
    <div className="space-y-4">
      <h3 className="font-display text-lg">DORA (team level)</h3>
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        {Object.entries(data.data.dora).map(([k, v]) => (
          <Card key={k} className="p-4">
            <div className="text-[13px] uppercase tracking-wide text-ink-soft">{k}</div>
            <div className="mt-1 font-display text-2xl">
              {v.value ?? '—'} {v.unit}
            </div>
            <p className="mt-1 text-[15px] text-ink-soft">{v.evidence}</p>
          </Card>
        ))}
      </div>
      <h3 className="font-display text-lg">Blocked work</h3>
      {(data.data.blocked.length ? data.data.blocked : [{ subject: 'none', conclusion: 'No blocked work', evidence: [] }]).map((f) => (
        <p key={f.subject} className="text-[15px]">
          {f.conclusion}
        </p>
      ))}
      <h3 className="font-display text-lg">Release readiness</h3>
      {data.data.readiness.map((f) => (
        <p key={f.subject} className="text-[15px]">
          {f.subject}: {f.conclusion}
        </p>
      ))}
    </div>
  );
}

function Activity({ d }: { d: ProjectDetail }) {
  if (!d.activity.length) return <EmptyState title="No activity yet" />;
  return (
    <Card className="divide-y divide-line">
      {d.activity.map((a) => (
        <div key={a.id} className="flex min-h-14 items-start justify-between gap-3 px-4 py-3">
          <span>
            <span className="font-semibold">{a.actorName}</span> <span className="text-ink-soft">{a.summary}</span>
          </span>
          <time className="shrink-0 text-[13px] text-ink-soft" dateTime={a.createdAt}>
            {new Date(a.createdAt).toLocaleString()}
          </time>
        </div>
      ))}
    </Card>
  );
}
