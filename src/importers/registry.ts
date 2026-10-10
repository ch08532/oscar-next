import type { MachineLoader } from "./machine-loader.js";

export class ImporterRegistry {
  readonly #loaders: MachineLoader[] = [];

  register(loader: MachineLoader): void {
    if (this.#loaders.some((candidate) => candidate.name === loader.name)) {
      throw new Error(`Importer already registered: ${loader.name}`);
    }
    this.#loaders.push(loader);
  }

  list(): readonly MachineLoader[] { return this.#loaders; }

  async detect(path: string): Promise<MachineLoader | undefined> {
    for (const loader of this.#loaders) {
      if (await loader.detect(path)) return loader;
    }
    return undefined;
  }
}
