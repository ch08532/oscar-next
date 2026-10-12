import test from "node:test";
import assert from "node:assert/strict";
import { createWaveformLayer } from "../apps/desktop/src/webgl-waveforms.js";
import type { PlotGeometry } from "../apps/desktop/src/chart-rendering.js";

function fixture(options: { shaderFailure?: boolean; bufferFailure?: boolean; allocationFailure?: boolean; connected?: boolean } = {}) {
  const calls = { created: 0, deleted: 0, uploads: 0, allocations: 0, shadersDeleted: 0, programsDeleted: 0, lost: 0, failures: 0, draws: [] as Array<[number, number]> };
  let contextLost = false;
  const gl = {
    VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, COMPILE_STATUS: 35713, LINK_STATUS: 35714,
    ALIASED_LINE_WIDTH_RANGE: 33902, COLOR_BUFFER_BIT: 16384, ARRAY_BUFFER: 34962,
    DYNAMIC_DRAW: 35048, FLOAT: 5126, LINES: 1, LINE_STRIP: 3, NO_ERROR: 0,
    createShader: () => ({}), shaderSource() {}, compileShader() {},
    getShaderParameter: () => !options.shaderFailure,
    createProgram: () => ({}), attachShader() {}, linkProgram() {}, getProgramParameter: () => true,
    getAttribLocation: () => 0, getUniformLocation: () => ({}), getParameter: () => Float32Array.of(1, 1),
    createBuffer: () => { if (options.bufferFailure) return null; calls.created++; return {}; },
    deleteBuffer() { calls.deleted++; }, bindBuffer() {}, bufferData() { calls.allocations++; }, bufferSubData() { calls.uploads++; },
    getError: () => options.allocationFailure ? 1285 : 0,
    deleteProgram() { calls.programsDeleted++; }, deleteShader() { calls.shadersDeleted++; },
    clearColor() {}, clear() {}, viewport() {}, useProgram() {}, enableVertexAttribArray() {}, flush() {},
    uniform2f() {}, lineWidth() {}, vertexAttribPointer() {}, uniform4f() {},
    drawArrays(mode: number, _first: number, count: number) { calls.draws.push([mode, count]); },
    isContextLost: () => contextLost,
    getExtension: () => ({ loseContext() { calls.lost++; contextLost = true; } }),
  };
  const canvas = Object.assign(new EventTarget(), {
    isConnected: options.connected ?? false, width: 0, height: 0, style: { height: "" },
    getContext: () => gl,
  });
  return { calls, canvas, asCanvas: canvas as unknown as HTMLCanvasElement, fail: () => { calls.failures++; }, lose: () => { contextLost = true; canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })); } };
}
const strip: PlotGeometry = { vertices: Float32Array.of(0, -1, 1, 1), mode: "strip" };
const segments: PlotGeometry = { vertices: Float32Array.of(0, -1, 0, 1), mode: "segments" };
const empty: PlotGeometry = { vertices: new Float32Array(), mode: "strip" };

test("WebGL reuses buffers across cursor/theme redraws and changed viewport geometry", () => {
  const f = fixture(), layer = createWaveformLayer(f.asCanvas, f.fail)!;
  assert.ok(layer);
  assert.equal(layer.draw([{ geometry: strip, color: "#1769aa" }], 1000, 200, 2, -1, 1), true);
  layer.draw([{ geometry: strip, color: "#1769aa" }], 1000, 200, 2, -1, 1);
  assert.equal(f.calls.created, 1); assert.equal(f.calls.uploads, 1);
  layer.draw([{ geometry: segments, color: "#1769aa" }], 1000, 200, 2, -1, 1);
  assert.equal(f.calls.created, 1); assert.equal(f.calls.uploads, 2); assert.equal(f.calls.allocations, 1);
  assert.deepEqual(f.calls.draws, [[3, 2], [3, 2], [1, 2]]);
  assert.equal(f.canvas.width, 2000); assert.equal(f.canvas.height, 400);
  layer.dispose(); layer.dispose();
  assert.equal(f.calls.deleted, 1); assert.equal(f.calls.programsDeleted, 1);
  assert.equal(f.calls.shadersDeleted, 2); assert.equal(f.calls.lost, 1);
});

test("empty/out-of-window recordings do not leak sparse GPU buffer slots", () => {
  const f = fixture(), layer = createWaveformLayer(f.asCanvas, f.fail)!;
  layer.draw([{ geometry: empty, color: "#1769aa" }, { geometry: strip, color: "#1769aa" }], 1000, 200, 1, -1, 1);
  assert.equal(f.calls.created, 1);
  layer.draw([{ geometry: strip, color: "#1769aa" }], 1000, 200, 1, -1, 1);
  assert.equal(f.calls.created, 2); assert.equal(f.calls.deleted, 1);
  layer.dispose(); assert.equal(f.calls.deleted, f.calls.created);
});

test("connected canvas contexts remain reusable during StrictMode effect replay", () => {
  const f = fixture({ connected: true });
  createWaveformLayer(f.asCanvas, f.fail)!.dispose();
  assert.equal(f.calls.lost, 0);
  const next = createWaveformLayer(f.asCanvas, f.fail)!;
  assert.equal(next.draw([{ geometry: strip, color: "#1769aa" }], 1000, 200, 1, -1, 1), true);
  f.canvas.isConnected = false; next.dispose(); assert.equal(f.calls.lost, 1);
});

test("GPU context loss reports failure and cleanup removes its event listener", () => {
  const f = fixture(), layer = createWaveformLayer(f.asCanvas, f.fail)!;
  f.lose(); assert.equal(f.calls.failures, 1);
  assert.equal(layer.draw([{ geometry: strip, color: "#1769aa" }], 1000, 200, 1, -1, 1), false);
  layer.dispose(); f.lose(); assert.equal(f.calls.failures, 1);
});

test("shader/allocation failures leave the caller able to select Canvas fallback", () => {
  const shader = fixture({ shaderFailure: true });
  assert.equal(createWaveformLayer(shader.asCanvas, shader.fail), undefined);
  assert.equal(shader.calls.shadersDeleted, 1); assert.equal(shader.calls.lost, 1);
  const buffer = fixture({ bufferFailure: true }), layer = createWaveformLayer(buffer.asCanvas, buffer.fail)!;
  assert.equal(layer.draw([{ geometry: strip, color: "#1769aa" }], 1000, 200, 1, -1, 1), false);
  assert.equal(buffer.calls.failures, 1); layer.dispose(); assert.equal(buffer.calls.programsDeleted, 1);
  const allocation = fixture({ allocationFailure: true }), outOfMemory = createWaveformLayer(allocation.asCanvas, allocation.fail)!;
  assert.equal(outOfMemory.draw([{ geometry: strip, color: "#1769aa" }], 1000, 200, 1, -1, 1), false);
  assert.equal(allocation.calls.failures, 1); assert.equal(allocation.calls.uploads, 0);
  outOfMemory.dispose(); assert.equal(allocation.calls.created, allocation.calls.deleted);
  const unavailable = { getContext: () => null } as unknown as HTMLCanvasElement;
  assert.equal(createWaveformLayer(unavailable, () => {}), undefined);
  const throwing = { getContext() { throw new Error("Synthetic unsupported context"); } } as unknown as HTMLCanvasElement;
  assert.equal(createWaveformLayer(throwing, () => {}), undefined);
});
