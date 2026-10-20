import { audit, enqueue, schema as s, type Tx } from '@higgsden/db';
import { environmentPath, renderWorkload, toYaml } from '@higgsden/domain';
import type { Providers } from '@higgsden/integrations';
import { eq } from 'drizzle-orm';

type Project = typeof s.projects.$inferSelect;
type Repo = typeof s.repositories.$inferSelect;
type Story = typeof s.stories.$inferSelect;
type Link = typeof s.pullRequestLinks.$inferSelect;

export async function runPullRequestPipeline(
  tx: Tx,
  providers: Providers,
  input: { project: Project; repo: Repo; story: Story; link: Link; sha: string },
) {
  const { project, repo, story, link, sha } = input;
  const kind = project.deliveryType ?? 'theme';
  const [run] = await tx
    .insert(s.workflowRuns)
    .values({
      agencyId: project.agencyId,
      projectId: project.id,
      type: kind === 'theme' ? 'theme.preview' : 'app.build',
      subjectType: 'pull_request_link',
      subjectId: link.id,
      status: 'running',
      currentStep: 'build',
      requestedBy: null,
      dedupeKey: `pr:${link.id}:${sha}`,
    })
    .onConflictDoNothing()
    .returning();
  if (!run) return;

  const [store] = await tx.select().from(s.storeConnections).where(eq(s.storeConnections.clientId, project.clientId));
  const envRows = await tx.select().from(s.environments).where(eq(s.environments.projectId, project.id));
  const staging = envRows.find((e) => e.name === 'staging') ?? envRows[0];

  if (kind === 'theme' && store) {
    const preview = await providers.themes.pushUnpublished({ domain: store.domain, secretRef: store.secretRef }, { name: `PR ${link.number}`, sourceRef: sha });
    await tx.insert(s.previewThemes).values({
      agencyId: project.agencyId,
      projectId: project.id,
      pullRequestLinkId: link.id,
      storeConnectionId: store.id,
      themeId: preview.themeId,
      name: `PR ${link.number}`,
      previewUrl: preview.previewUrl,
    });
    await providers.github.comment(0, repo.fullName, link.number, `Preview theme: ${preview.previewUrl}`);
    await tx.update(s.workflowRuns).set({ status: 'succeeded', currentStep: 'preview', finishedAt: new Date(), updatedAt: new Date() }).where(eq(s.workflowRuns.id, run.id));
    await audit(tx, { agencyId: project.agencyId, actorKind: 'system', clientId: project.clientId, projectId: project.id, entityType: 'preview_theme', action: 'theme.preview', summary: `Pushed unpublished preview for ${story.key} PR #${link.number}` });
    return;
  }

  const build = await providers.builds.run({
    codebuildProject: `${project.key.toLowerCase()}-app`,
    repository: repo.fullName,
    commitSha: sha,
    kind: 'app',
    ecrRepository: `${project.key.toLowerCase()}-app`,
  });
  const [buildRow] = await tx
    .insert(s.builds)
    .values({
      agencyId: project.agencyId,
      projectId: project.id,
      workflowRunId: run.id,
      commitSha: sha,
      imageUri: build.imageUri,
      status: build.status === 'SUCCEEDED' ? 'succeeded' : 'failed',
      durationSeconds: build.durationSeconds,
      finishedAt: new Date(),
    })
    .returning();
  for (const line of build.logLines) {
    await tx.insert(s.logEntries).values({
      agencyId: project.agencyId,
      projectId: project.id,
      environmentId: staging?.id,
      source: 'codebuild',
      stream: buildRow!.id,
      level: line.level,
      message: line.message,
    });
  }
  if (build.status !== 'SUCCEEDED') {
    await tx.update(s.workflowRuns).set({ status: 'failed', error: 'Build failed', finishedAt: new Date(), updatedAt: new Date() }).where(eq(s.workflowRuns.id, run.id));
    await enqueue(tx, project.agencyId, 'events', 'build.failed', { agencyId: project.agencyId, projectId: project.id, storyId: story.id, commitSha: sha });
    return;
  }
  if (staging) {
    const manifest = toYaml({ image: build.imageUri, sha, environment: 'staging' });
    const [commit] = await tx
      .insert(s.gitopsCommits)
      .values({
        agencyId: project.agencyId,
        projectId: project.id,
        repository: `higgsden/${project.key.toLowerCase()}-gitops`,
        path: environmentPath(project.key, 'staging'),
        message: `Deploy ${sha.slice(0, 12)} to staging for ${story.key}`,
        sha,
        content: manifest,
      })
      .returning();
    await providers.argo.sync(staging.argoApplication ?? `${project.key.toLowerCase()}-staging`, sha);
    await tx.insert(s.deployments).values({
      agencyId: project.agencyId,
      clientId: project.clientId,
      projectId: project.id,
      environmentId: staging.id,
      version: sha,
      status: 'succeeded',
      storyId: story.id,
      pullRequestLinkId: link.id,
      gitopsCommitId: commit!.id,
      workflowRunId: run.id,
      changeCommittedAt: new Date(),
      finishedAt: new Date(),
    });
    await tx.update(s.environments).set({ currentVersion: sha }).where(eq(s.environments.id, staging.id));
  }
  await tx.update(s.workflowRuns).set({ status: 'succeeded', currentStep: 'staging', finishedAt: new Date(), updatedAt: new Date() }).where(eq(s.workflowRuns.id, run.id));
  await audit(tx, { agencyId: project.agencyId, actorKind: 'system', clientId: project.clientId, projectId: project.id, entityType: 'deployment', action: 'deployment.staging', summary: `Deployed ${sha.slice(0, 12)} to staging for ${story.key}` });
}

export async function requestProductionDeploy(
  tx: Tx,
  actorId: string,
  project: Project,
  version: string,
) {
  const [production] = (await tx.select().from(s.environments).where(eq(s.environments.projectId, project.id))).filter((e) => e.name === 'production');
  if (!production) throw new Error('Production environment is not provisioned.');
  const [deployment] = await tx
    .insert(s.deployments)
    .values({
      agencyId: project.agencyId,
      clientId: project.clientId,
      projectId: project.id,
      environmentId: production.id,
      version,
      status: 'pending_approval',
      requestedBy: actorId,
      changeCommittedAt: new Date(),
    })
    .returning();
  await audit(tx, { agencyId: project.agencyId, actorId, clientId: project.clientId, projectId: project.id, entityType: 'deployment', entityId: deployment!.id, action: 'deployment.request', summary: `Requested production deploy of ${version.slice(0, 12)}` });
  return deployment!;
}

export { renderWorkload };
