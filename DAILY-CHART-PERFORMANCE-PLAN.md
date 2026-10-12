# Daily chart performance plan — 2026-10-12

1. Profile synthetic eight-hour Daily nights through the actual shared renderer.
   Measure cursor bursts, zoom/pan, Canvas drawing work and sampled CPU stacks.
   Record the existing behavior before changing the renderer.
2. Coalesce pointer/viewport updates using animation frames, keep filtered series
   stable across cursor changes, cache visible bounds, and avoid resizing Canvas
   backing stores on every draw. Preserve synchronized cursors, wheel prevention,
   exact/adaptive backend loading, layout, bookmarks and empty states.
3. Add an optional native WebGL waveform layer for dense rows, retaining Canvas
   axes/text/event flags/cursor overlays and an automatic Canvas waveform fallback
   when WebGL is unavailable, fails, or loses its context. Share geometry between
   renderers so extrema, list gaps, viewport edges and time precision agree.
   Restrict GPU contexts to dense high-rate rows; dispose buffers/contexts when
   rows are removed. No new chart library, schema or backend API changes.
4. Test frame coalescing/cleanup and geometry parity with typed arrays, including
   epoch timestamps, spikes, invalid values and split recordings. Compare CPU
   and interaction measurements before/after. Exercise GPU initialization,
   unavailable/lost-context fallbacks and existing graph interactions in the
   actual browser/Electron renderer where available.
5. Run root verification, renderer builds/typecheck, and record measured results
   and hardware/platform limits. Synthetic/software-GPU results must not be
   represented as a physical GPU or Raspberry Pi acceptance result.
