import { randomInt } from 'node:crypto';
import type { Sandbox } from './sandbox.js';

export interface StoreRef {
  domain: string;
  /** Secrets Manager name holding the theme access token. */
  secretRef: string;
}

export interface ThemeProvider {
  readonly mode: 'fake' | 'real';
  /** Pushes an unpublished theme. Pushing the same name again updates that theme. */
  pushUnpublished(store: StoreRef, input: { name: string; sourceRef: string }): Promise<{ themeId: string; previewUrl: string }>;
  deleteTheme(store: StoreRef, themeId: string): Promise<void>;
  /** Publishes a theme as live and returns the theme it replaced. */
  publish(store: StoreRef, themeId: string): Promise<{ previousThemeId: string | null }>;
  liveThemeId(store: StoreRef): Promise<string | null>;
}

type FakeTheme = { themeId: string; name: string; sourceRef: string; role: 'unpublished' | 'main'; domain: string };

/** Development-store stand-in. Real theme pushes run the Shopify CLI inside CodeBuild. */
export class FakeShopify implements ThemeProvider {
  readonly mode = 'fake' as const;

  constructor(private readonly sandbox: Sandbox) {}

  private async themes(domain: string): Promise<FakeTheme[]> {
    return (await this.sandbox.list<FakeTheme>('shopify_theme')).map((t) => t.data).filter((t) => t.domain === domain);
  }

  async pushUnpublished(store: StoreRef, input: { name: string; sourceRef: string }) {
    const existing = (await this.themes(store.domain)).find((t) => t.name === input.name);
    const themeId = existing?.themeId ?? String(randomInt(100_000_000_000, 999_999_999_999));
    await this.sandbox.put('shopify_theme', `${store.domain}:${themeId}`, {
      themeId,
      name: input.name,
      sourceRef: input.sourceRef,
      role: existing?.role ?? 'unpublished',
      domain: store.domain,
    });
    return { themeId, previewUrl: `https://${store.domain}/?preview_theme_id=${themeId}` };
  }

  async deleteTheme(store: StoreRef, themeId: string) {
    await this.sandbox.remove('shopify_theme', `${store.domain}:${themeId}`);
  }

  async publish(store: StoreRef, themeId: string) {
    const themes = await this.themes(store.domain);
    const previous = themes.find((t) => t.role === 'main') ?? null;
    for (const t of themes) {
      const role = t.themeId === themeId ? 'main' : 'unpublished';
      await this.sandbox.put('shopify_theme', `${store.domain}:${t.themeId}`, { ...t, role });
    }
    return { previousThemeId: previous?.themeId ?? null };
  }

  async liveThemeId(store: StoreRef) {
    return (await this.themes(store.domain)).find((t) => t.role === 'main')?.themeId ?? null;
  }
}
