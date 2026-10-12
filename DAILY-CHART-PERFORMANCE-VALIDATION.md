# Daily chart performance validation — 2026-10-12

## Scope and findings

Implemented all three steps in [the plan](DAILY-CHART-PERFORMANCE-PLAN.md):
profile the existing renderer, reduce redundant Canvas work, and accelerate
dense waveform strokes with native WebGL and automatic Canvas fallback.

Cursor changes recreated filtered series arrays, invalidating waveform drawing
effects. Those effects also recalculated visible bounds and resized backing
canvases. ResizeObserver's initial notification duplicated drawing work.
Stable series arrays, cached bounds/typed geometry, conditional backing-store
resizing and size-aware observers remove that work. Cursor and viewport updates
now commit at most once per animation frame; successive wheel events use the
latest pending viewport so coalescing preserves their combined effect.

Dense Flow and high-rate Mask Pressure recordings (source count at least 20,000)
enable a WebGL stroke layer. The three eligible rows are Flow, combined Pressure,
and Mask Pressure. Axes, labels, event flags and cursor overlays remain Canvas.
Both stroke paths share typed geometry, per-pixel minima/maxima, edge neighbors
and separate recording lists. Relative time is calculated before conversion to
float32 to preserve epoch-time precision. Query/storage semantics are unchanged.

GPU buffers reuse capacity and upload only changed geometry. Allocation errors,
unavailable contexts, initialization failures and context loss select Canvas.
Removed rows release resources; connected canvases remain reusable during React
StrictMode effect replay. No new dependency or generic backend capability was
added. Line rasterization/antialiasing can vary between Canvas and GPU drivers.

## Environment and method

- Windows build 26200; Node v24.21.0; npm 11.19.0.
- Native ANGLE/D3D11 Intel Iris Xe GPU, not a software WebGL renderer.
- Isolated synthetic database: one eight-hour night, 25 Hz Flow/Mask Pressure,
  fourteen 0.5 Hz channels and synthetic events; fourteen visible graph rows.
- Browser REST renderer and actual Electron preload/IPC renderer exercised
  through Chrome DevTools Protocol in hidden windows. Automatic media watching
  was disabled in the isolated desktop validation helper.
- No real therapy database or source card was used for this validation.

CPU sampling and Canvas instrumentation covered twelve bursts of eight events
per cursor/zoom/pan phase. The baseline loaded the pre-change Charts component.
Offscreen scheduling and instrumentation made wall-clock/frame timings noisy;
these runs establish redundant-work reduction, not a physical-display FPS claim.

| Phase | Baseline Canvas lineTo calls | Optimized Canvas | Hybrid WebGL |
| --- | ---: | ---: | ---: |
| Cursor | 377,570 | 168 | 168 |
| Zoom | 337,733 | 31,338 | 71,409 |
| Pan | 358,502 | 26,435 | 16,063 |

Query completion and frame scheduling affect the number of zoom/pan redraws;
the hybrid result is not uniformly faster than optimized Canvas in this short
interaction trace. Canvas counters also exclude GPU strokes. The clearer cursor
regression check dispatched 100 pointer moves in one burst: **zero base waveform
redraws and fourteen overlay redraws**, passing in both browser and Electron.

A separate controlled drawing test used 12,000 samples reduced to 3,696 geometry
floats across 924 plot pixels. Five warmed runs of 100 redraws with reused geometry
and buffers measured median JavaScript command-submission time of **6.8 ms Canvas
versus 0.5 ms WebGL**. This excludes GPU completion, geometry generation, React,
queries and presentation; it must not be interpreted as end-to-end speedup.
Pixel readback confirmed nonempty strokes, positive/negative spike preservation
and no GL error. Canvas and GPU painted 18,912 and 18,626 pixels respectively;
pixel identity is not expected across rasterizers.

## Results

| Check | Result |
| --- | --- |
| Baseline `npm run verify` | PASS: 159 tests and demo smoke |
| Final `npm run verify` | PASS: 168 tests and demo smoke |
| `npm --prefix apps/desktop run build` | PASS |
| `npm --prefix apps/desktop run build:headless` | PASS after resolving sandbox EPERM on generated assets |
| Renderer `tsc --noEmit -p tsconfig.json` from apps/desktop | PASS |
| `git diff --check` | PASS |
| Browser and Electron cursor bursts, shared wheel zoom, burst pan | PASS |
| Native nonpassive wheel cancellation | PASS |
| Viewport bookmark persistence and deletion | PASS |
| Three GPU rows paint; DPR 1, 1.25, 2 backing-size alignment | PASS |
| Actual WEBGL_lose_context switches to populated Canvas | PASS |
| Unavailable/throwing context, shader, buffer and GL allocation failures | PASS: populated Canvas fallback in both apps |

Nine added unit tests cover frame coalescing/cancellation/reuse, geometry caches,
epoch precision, extrema, zero/invalid samples, separate recordings, GPU buffer
reuse/cleanup, sparse buffer slots, StrictMode lifecycle and failure handling.
Ignored `.validation/` helpers contain the synthetic fixture, profiling scripts,
CPU traces and runtime assertions; databases/build outputs are not committed.

## Remaining validation

Physical mouse/display acceptance, prolonged real-card workloads, installers,
other GPU drivers, Raspberry Pi, macOS and Linux remain unverified. GPU context
loss deliberately keeps the affected mounted row on Canvas. Restart the desktop
app, or reload the browser against a restarted headless server, to use the rebuilt
renderer. This work does not establish clinical validation.
