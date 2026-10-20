export interface EmbeddingClient {
  embedQuery(text: string): Promise<{ model: string; vector: number[] }>;
  rerank(query: string, documents: { id: string; text: string }[]): Promise<{ id: string; score: number }[]>;
  health(): Promise<{ status: string; model: string }>;
}

/** Calls the Python embedding service. It holds no database credentials and keeps no tenant text. */
export class HttpEmbeddingClient implements EmbeddingClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
  ) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.serviceToken}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Embedding service ${path} returned ${res.status}`);
    return (await res.json()) as T;
  }

  embedQuery(text: string) {
    return this.post<{ model: string; vector: number[] }>('/embed-query', { text });
  }

  async rerank(query: string, documents: { id: string; text: string }[]) {
    if (documents.length === 0) return [];
    const result = await this.post<{ results: { id: string; score: number }[] }>('/rerank', { query, documents });
    return result.results;
  }

  async health() {
    const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3_000) });
    return (await res.json()) as { status: string; model: string };
  }
}
