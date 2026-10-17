import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("compiled preload loads with sandbox CommonJS and exposes the scoped IPC API", async () => {
  const source = new TextDecoder().decode(await readFile("dist/src/desktop/preload.cjs"));
  let bridge: any;
  const calls: unknown[][] = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (name: string, api: unknown) => {
      assert.equal(name, "oscar"); bridge = api;
    } },
    ipcRenderer: { invoke: (...args: unknown[]) => { calls.push(args); return Promise.resolve("ok"); } },
  };
  new Function("require", "exports", source)((name: string) => {
    assert.equal(name, "electron"); return electron;
  }, {});
  assert.equal(await bridge.getAppInfo(), "ok");
  assert.equal(await bridge.getDaily(123, "2026-10-09"), "ok");
  assert.equal(await bridge.getTherapyHistory(123, "2026-10-01", "2026-10-09"), "ok");
  assert.deepEqual(calls, [["app:getInfo"], ["daily:get", 123, "2026-10-09"], ["therapyHistory:get", 123, "2026-10-01", "2026-10-09"]]);
  calls.length = 0;
  await bridge.getDailyChannelAnalysis(123, "2026-10-09");
  await bridge.getTherapyAnalysisPreferences(123);
  await bridge.setTherapyAnalysisPreferences(123, { leakThreshold: 30, showLeakThreshold: false });
  await bridge.setGraphVisibility(123, { flow: false, "respiratory-rate": true });
  assert.deepEqual(calls, [
    ["daily:getChannelAnalysis", 123, "2026-10-09"], ["analysis:getPreferences", 123],
    ["analysis:setPreferences", 123, { leakThreshold: 30, showLeakThreshold: false }],
    ["graphs:setVisibility", 123, { flow: false, "respiratory-rate": true }],
  ]);
  assert.equal(bridge.require, undefined);
  calls.length=0;
  await bridge.getGroqSettings();
  await bridge.configureGroq({provider:"groq",enabled:true,model:"synthetic/model",apiKey:"synthetic-key"});
  await bridge.testGroq();
  await bridge.listGroqModels();
  assert.deepEqual(calls,[["ai:groqSettings"],["ai:groqConfigure",{provider:"groq",enabled:true,model:"synthetic/model",apiKey:"synthetic-key"}],["ai:groqCheck"],["ai:groqModels"]]);
  calls.length=0;
  await bridge.getAISettings();
  await bridge.startAI({profileId:1,machineId:123,type:"analysis",dateMode:"single",date:"2026-10-16",intent:"ahi_analysis"});
  await bridge.clearAIHistory({profileId:1,machineId:123});
  assert.deepEqual(calls,[["ai:settings"],["ai:start",{profileId:1,machineId:123,type:"analysis",dateMode:"single",date:"2026-10-16",intent:"ahi_analysis"}],["ai:clear",{profileId:1,machineId:123},undefined]]);
  calls.length = 0;
  await bridge.getExpertSettings();
  await bridge.startExpertReview({ profileId:1,machineId:123,date:"2026-10-09",reviewType:"night" });
  await bridge.cancelExpertReview("synthetic-id",{profileId:1,machineId:123});
  assert.deepEqual(calls,[["expert:getSettings"],["expert:start",{profileId:1,machineId:123,date:"2026-10-09",reviewType:"night"}],["expert:cancel","synthetic-id",{profileId:1,machineId:123}]]);
});
