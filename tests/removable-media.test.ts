import test from "node:test";
import assert from "node:assert/strict";
import { RemovableMediaWatcher, type VolumeInfo, type VolumeProvider } from "../src/desktop/removable-media.js";
import type { ImportPreview } from "../src/importers/import-service.js";

class FakeProvider implements VolumeProvider {
  volumes: VolumeInfo[] = [];
  async listVolumes(): Promise<VolumeInfo[]> { return this.volumes; }
}

function preview(rootPath: string): ImportPreview {
  return {
    sourcePath: rootPath,
    importerName: "ResMed",
    machine: { type: 1 as any, capabilities: 0, loaderName: "ResMed", brand: "ResMed", model: "AirSense 11 AutoSet", modelNumber: "39000", serial: "12345678901", series: "", version: 1 },
    fileCount: 12,
  };
}

test("removable watcher probes existing media once and prompts once", async () => {
  const provider = new FakeProvider();
  provider.volumes = [{ rootPath: "E:\\\\", label: "RESMED", removable: true }];
  const probed: string[] = [];
  const detected: string[] = [];
  const watcher = new RemovableMediaWatcher({
    provider,
    probe: async (root) => { probed.push(root); return preview(root); },
    onDetected: ({ preview: found }) => detected.push(found.sourcePath),
  });

  await watcher.pollOnce();
  await watcher.pollOnce();
  assert.deepEqual(probed, ["E:\\\\"]);
  assert.deepEqual(detected, ["E:\\\\"]);
});

test("removable watcher detects a newly mounted card and allows reinsert", async () => {
  const provider = new FakeProvider();
  const detected: string[] = [];
  const watcher = new RemovableMediaWatcher({
    provider,
    probe: async (root) => root === "F:\\\\" ? preview(root) : undefined,
    onDetected: ({ preview: found }) => detected.push(found.sourcePath),
    probeExistingOnStart: false,
  });

  await watcher.pollOnce();
  provider.volumes = [{ rootPath: "F:\\\\", removable: true }];
  await watcher.pollOnce();
  await watcher.pollOnce();
  assert.deepEqual(detected, ["F:\\\\"]);

  provider.volumes = [];
  await watcher.pollOnce();
  provider.volumes = [{ rootPath: "F:\\\\", removable: true }];
  await watcher.pollOnce();
  assert.deepEqual(detected, ["F:\\\\", "F:\\\\"]);
});

test("unsupported mounted volumes do not trigger detection", async () => {
  const provider = new FakeProvider();
  provider.volumes = [{ rootPath: "/media/USB", removable: true }];
  let count = 0;
  const watcher = new RemovableMediaWatcher({
    provider,
    probe: async () => undefined,
    onDetected: () => { count += 1; },
  });
  await watcher.pollOnce();
  await watcher.pollOnce();
  assert.equal(count, 0);
});
