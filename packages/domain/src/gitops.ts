// Manifests the product commits to an Agency's GitOps repository. Argo CD in the cell applies them.

type Yaml = string | number | boolean | null | Yaml[] | { [key: string]: Yaml | undefined };

/** Minimal YAML writer for the manifest shapes below. Strings are always quoted. */
export function toYaml(value: Yaml, indent = 0): string {
  const pad = ' '.repeat(indent);
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map((item) => {
        const rendered = toYaml(item, indent + 2);
        return typeof item === 'object' && item !== null && !Array.isArray(item) ? `${pad}- ${rendered.trimStart()}` : `${pad}- ${rendered}`;
      })
      .join('\n');
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined) as [string, Yaml][];
  if (entries.length === 0) return '{}';
  return entries
    .map(([k, v]) => {
      if (typeof v === 'object' && v !== null && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0)) {
        return `${pad}${k}:\n${toYaml(v, indent + 2)}`;
      }
      return `${pad}${k}: ${toYaml(v, indent + 2)}`;
    })
    .join('\n');
}

export const documents = (...docs: Yaml[]) => docs.map((d) => toYaml(d)).join('\n---\n') + '\n';

export interface TierSpec {
  code: string;
  cpuMillicores: number;
  memoryMb: number;
  minReplicas: number;
  maxReplicas: number;
  storageGb: number;
}

export interface EnvironmentSpec {
  agencySlug: string;
  agencyId: string;
  clientId: string;
  projectId: string;
  projectKey: string;
  environment: 'preview' | 'staging' | 'production';
  namespace: string;
  host: string;
  image: string | null;
  tier: TierSpec;
  pinnedMaxReplicas: number | null;
  scaledToZero: boolean;
}

export function environmentPath(projectKey: string, environment: string): string {
  return `projects/${projectKey.toLowerCase()}/${environment}`;
}

export function labels(spec: Pick<EnvironmentSpec, 'agencyId' | 'clientId' | 'projectId' | 'environment'>) {
  return {
    'higgsden.io/agency': spec.agencyId,
    'higgsden.io/client': spec.clientId,
    'higgsden.io/project': spec.projectId,
    'higgsden.io/environment': spec.environment,
  };
}

/** Namespace policy from the hosting tier: quota, default limits, and the priority class for the node pool. */
export function renderTierPolicy(spec: EnvironmentSpec): string {
  const t = spec.tier;
  const maxReplicas = spec.pinnedMaxReplicas ?? t.maxReplicas;
  return documents(
    {
      apiVersion: 'v1',
      kind: 'ResourceQuota',
      metadata: { name: 'tier', namespace: spec.namespace, labels: labels(spec) },
      spec: {
        hard: {
          'requests.cpu': `${t.cpuMillicores * maxReplicas}m`,
          'requests.memory': `${t.memoryMb * maxReplicas}Mi`,
          'limits.cpu': `${t.cpuMillicores * maxReplicas * 2}m`,
          'limits.memory': `${t.memoryMb * maxReplicas}Mi`,
          'requests.storage': `${t.storageGb}Gi`,
          pods: String(maxReplicas + 2),
        },
      },
    },
    {
      apiVersion: 'v1',
      kind: 'LimitRange',
      metadata: { name: 'tier', namespace: spec.namespace },
      spec: {
        limits: [
          {
            type: 'Container',
            default: { cpu: `${t.cpuMillicores * 2}m`, memory: `${t.memoryMb}Mi` },
            defaultRequest: { cpu: `${t.cpuMillicores}m`, memory: `${t.memoryMb}Mi` },
          },
        ],
      },
    },
  );
}

export function renderWorkload(spec: EnvironmentSpec): string {
  const t = spec.tier;
  const app = `${spec.projectKey.toLowerCase()}-${spec.environment}`;
  const maxReplicas = spec.scaledToZero ? 0 : (spec.pinnedMaxReplicas ?? t.maxReplicas);
  const minReplicas = spec.scaledToZero ? 0 : Math.min(t.minReplicas, maxReplicas);
  const meta = { name: app, namespace: spec.namespace, labels: { ...labels(spec), app } };
  return documents(
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: meta,
      spec: {
        replicas: minReplicas,
        selector: { matchLabels: { app } },
        template: {
          metadata: { labels: { ...labels(spec), app } },
          spec: {
            serviceAccountName: app,
            priorityClassName: spec.environment === 'production' ? 'hosted-production' : 'hosted-nonproduction',
            nodeSelector: { 'karpenter.sh/nodepool': spec.environment === 'production' ? 'production' : 'nonproduction' },
            securityContext: { runAsNonRoot: true, seccompProfile: { type: 'RuntimeDefault' } },
            containers: [
              {
                name: 'app',
                image: spec.image ?? 'public.ecr.aws/nginx/nginx:stable',
                ports: [{ containerPort: 3000 }],
                envFrom: [{ secretRef: { name: `${app}-env` } }],
                resources: {
                  requests: { cpu: `${t.cpuMillicores}m`, memory: `${t.memoryMb}Mi` },
                  limits: { cpu: `${t.cpuMillicores * 2}m`, memory: `${t.memoryMb}Mi` },
                },
                readinessProbe: { httpGet: { path: '/healthz', port: 3000 }, periodSeconds: 5 },
                securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } },
              },
            ],
          },
        },
      },
    },
    { apiVersion: 'v1', kind: 'Service', metadata: meta, spec: { selector: { app }, ports: [{ port: 80, targetPort: 3000 }] } },
    {
      apiVersion: 'autoscaling/v2',
      kind: 'HorizontalPodAutoscaler',
      metadata: meta,
      spec: {
        scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: app },
        minReplicas: Math.max(minReplicas, maxReplicas === 0 ? 0 : 1),
        maxReplicas,
        metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } } }],
      },
    },
    {
      apiVersion: 'gateway.networking.k8s.io/v1',
      kind: 'HTTPRoute',
      metadata: meta,
      spec: {
        parentRefs: [{ name: 'hosted', namespace: 'envoy-gateway-system' }],
        hostnames: [spec.host],
        rules: [{ backendRefs: [{ name: app, port: 80 }] }],
      },
    },
    {
      apiVersion: 'external-secrets.io/v1',
      kind: 'ExternalSecret',
      metadata: { name: `${app}-env`, namespace: spec.namespace },
      spec: {
        refreshInterval: '1h',
        secretStoreRef: { kind: 'ClusterSecretStore', name: 'aws-secrets-manager' },
        target: { name: `${app}-env` },
        dataFrom: [{ extract: { key: `/${spec.agencyId}/${spec.clientId}/${spec.projectKey.toLowerCase()}/${spec.environment}/app` } }],
      },
    },
  );
}

export function renderArgoApplication(input: { name: string; agencySlug: string; gitopsRepo: string; path: string; namespace: string; autoSync: boolean }): string {
  return documents({
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Application',
    metadata: { name: input.name, namespace: 'argocd' },
    spec: {
      project: input.agencySlug,
      source: { repoURL: `https://github.com/${input.gitopsRepo}.git`, targetRevision: 'main', path: input.path },
      destination: { server: 'https://kubernetes.default.svc', namespace: input.namespace },
      syncPolicy: input.autoSync ? { automated: { prune: true, selfHeal: true }, syncOptions: ['CreateNamespace=false'] } : { syncOptions: ['CreateNamespace=false'] },
    },
  });
}

export function renderArgoProject(input: { agencySlug: string; agencyId: string; gitopsRepo: string }): string {
  return documents({
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'AppProject',
    metadata: { name: input.agencySlug, namespace: 'argocd' },
    spec: {
      description: `Hosted apps for Agency ${input.agencyId}`,
      sourceRepos: [`https://github.com/${input.gitopsRepo}.git`],
      destinations: [{ server: 'https://kubernetes.default.svc', namespace: `${input.agencySlug}-*` }],
      clusterResourceWhitelist: [],
      namespaceResourceWhitelist: [
        { group: 'apps', kind: 'Deployment' },
        { group: '', kind: 'Service' },
        { group: '', kind: 'ServiceAccount' },
        { group: 'autoscaling', kind: 'HorizontalPodAutoscaler' },
        { group: 'gateway.networking.k8s.io', kind: 'HTTPRoute' },
        { group: 'external-secrets.io', kind: 'ExternalSecret' },
        { group: '', kind: 'ResourceQuota' },
        { group: '', kind: 'LimitRange' },
        { group: 'keda.sh', kind: 'ScaledObject' },
        { group: 'cert-manager.io', kind: 'Certificate' },
      ],
    },
  });
}

/** The Crossplane composite claim that provisions everything one app environment needs. */
export function renderAppClaim(input: EnvironmentSpec & { databaseInstance: string; ecrRepository: string; codebuildProject: string; repository: string }): string {
  return documents({
    apiVersion: 'platform.higgsden.io/v1alpha1',
    kind: 'ShopifyAppEnvironment',
    metadata: { name: `${input.projectKey.toLowerCase()}-${input.environment}`, namespace: input.namespace, labels: labels(input) },
    spec: {
      tier: input.tier.code,
      repository: input.repository,
      ecrRepository: input.ecrRepository,
      codebuildProject: input.codebuildProject,
      database: { instance: input.databaseInstance, name: `${input.agencySlug}_${input.projectKey.toLowerCase()}_${input.environment}`.replaceAll('-', '_') },
      secretPath: `/${input.agencyId}/${input.clientId}/${input.projectKey.toLowerCase()}/${input.environment}/app`,
      host: input.host,
      tags: { 'higgsden:agency': input.agencyId, 'higgsden:client': input.clientId, 'higgsden:project': input.projectId },
    },
  });
}

export function renderCertificate(input: { name: string; namespace: string; hostname: string }): string {
  return documents({
    apiVersion: 'cert-manager.io/v1',
    kind: 'Certificate',
    metadata: { name: input.name, namespace: input.namespace },
    spec: { secretName: `${input.name}-tls`, dnsNames: [input.hostname], issuerRef: { kind: 'ClusterIssuer', name: 'letsencrypt' } },
  });
}
