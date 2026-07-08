/**
 * Minimal keyed registry shared by all adapter categories. Providers register
 * themselves by their `key`; the engine resolves them at runtime with no
 * compile-time dependency on concrete implementations.
 */
export interface Keyed {
  readonly key: string;
}

export class ProviderRegistry<T extends Keyed> {
  private readonly providers = new Map<string, T>();

  constructor(private readonly label: string) {}

  register(provider: T): this {
    this.providers.set(provider.key, provider);
    return this;
  }

  get(key: string): T {
    const provider = this.providers.get(key);
    if (!provider) {
      throw new Error(
        `No ${this.label} provider registered for key "${key}". Registered: ${[...this.providers.keys()].join(', ') || '(none)'}`,
      );
    }
    return provider;
  }

  has(key: string): boolean {
    return this.providers.has(key);
  }

  keys(): string[] {
    return [...this.providers.keys()];
  }
}
