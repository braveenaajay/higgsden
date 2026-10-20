import type { DemoUser, MeResponse, ProjectDetail, WorkspaceResponse } from '@higgsden/contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload?: { code?: string; message?: string },
  ) {
    super(payload?.message ?? `Request failed with ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  if (!res.ok) {
    let payload: { code?: string; message?: string } | undefined;
    try {
      payload = (await res.json()) as { code?: string; message?: string };
    } catch {
      payload = undefined;
    }
    throw new ApiError(res.status, payload);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  demoUsers: () => request<DemoUser[]>('/dev/users'),
  demoSignIn: (userId: string) => request<void>('/dev/sign-in', { method: 'POST', body: JSON.stringify({ userId }) }),
  signOut: () => request<void>('/logout', { method: 'POST' }),
  me: () => request<MeResponse>('/me'),
  workspace: (agencyId: string) => request<WorkspaceResponse & Record<string, unknown>>(`/agencies/${agencyId}/workspace`),
  project: (agencyId: string, projectId: string) => request<ProjectDetail & Record<string, unknown>>(`/agencies/${agencyId}/projects/${projectId}`),
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
