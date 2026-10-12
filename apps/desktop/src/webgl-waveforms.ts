import type { PlotGeometry } from "./chart-rendering.js";

export interface WaveformMesh { geometry: PlotGeometry; color: string; }
export interface WaveformLayer {
  draw(meshes: readonly WaveformMesh[], width: number, height: number, dpr: number, yMin: number, yMax: number): boolean;
  dispose(): void;
}

/** Only waveform strokes use WebGL; Canvas retains axes, text and cursor UI. */
export function createWaveformLayer(canvas: HTMLCanvasElement, onFailure: () => void): WaveformLayer | undefined {
  let gl: WebGLRenderingContext | null;
  try { gl = canvas.getContext("webgl", { alpha: true, antialias: true, depth: false, stencil: false, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: true }); }
  catch { return undefined; }
  if (!gl) return undefined;
  const context = gl;
  let program: WebGLProgram | undefined;
  let disposed = false;
  const buffers: Array<{ buffer: WebGLBuffer; capacity: number; geometry?: PlotGeometry }> = [];
  const shaders: WebGLShader[] = [];
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener("webglcontextlost", lost);
    for (const slot of buffers) if (slot) context.deleteBuffer(slot.buffer);
    buffers.length = 0;
    if (program) context.deleteProgram(program);
    for (const shader of shaders) context.deleteShader(shader);
    // React StrictMode replays effects while retaining the same canvas. Keep
    // that context reusable; release the GPU slot when the canvas is removed.
    if (!canvas.isConnected) context.getExtension("WEBGL_lose_context")?.loseContext();
  };
  const lost = (event: Event) => { event.preventDefault(); onFailure(); };
  canvas.addEventListener("webglcontextlost", lost);
  try {
    const compile = (type: number, source: string) => {
      const shader = context.createShader(type);
      if (!shader) throw new Error("Shader unavailable");
      shaders.push(shader); context.shaderSource(shader, source); context.compileShader(shader);
      if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) throw new Error("Shader compilation failed");
      return shader;
    };
    const vertex = compile(context.VERTEX_SHADER, `
      attribute vec2 aPoint;
      uniform vec2 uY;
      void main() { gl_Position = vec4(aPoint.x * 2.0 - 1.0, (aPoint.y - uY.x) / uY.y * 2.0 - 1.0, 0.0, 1.0); }
    `);
    const fragment = compile(context.FRAGMENT_SHADER, `
      precision mediump float;
      uniform vec4 uColor;
      void main() { gl_FragColor = uColor; }
    `);
    program = context.createProgram() ?? undefined;
    if (!program) throw new Error("Program unavailable");
    context.attachShader(program, vertex); context.attachShader(program, fragment); context.linkProgram(program);
    if (!context.getProgramParameter(program, context.LINK_STATUS)) throw new Error("Program linking failed");
    for (const shader of shaders) context.deleteShader(shader);
    shaders.length = 0;
    const point = context.getAttribLocation(program, "aPoint");
    const y = context.getUniformLocation(program, "uY"), color = context.getUniformLocation(program, "uColor");
    if (point < 0 || y === null || color === null) throw new Error("Shader bindings unavailable");
    const lineRange = context.getParameter(context.ALIASED_LINE_WIDTH_RANGE) as Float32Array;
    return {
      draw(meshes, width, height, dpr, yMin, yMax) {
        if (disposed || context.isContextLost()) return false;
        try {
          const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
          if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
          if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
          canvas.style.height = `${height}px`;
          context.clearColor(0, 0, 0, 0); context.clear(context.COLOR_BUFFER_BIT);
          context.viewport(Math.round(64 * dpr), Math.round(28 * dpr), Math.max(1, Math.round((width - 76) * dpr)), Math.max(1, Math.round((height - 38) * dpr)));
          context.useProgram(program!); context.enableVertexAttribArray(point);
          context.uniform2f(y, yMin, Math.max(1e-9, yMax - yMin));
          context.lineWidth(Math.max(lineRange[0] ?? 1, Math.min(lineRange[1] ?? 1, dpr)));
          while (buffers.length > meshes.length) { const slot = buffers.pop(); if (slot) context.deleteBuffer(slot.buffer); }
          for (let index = 0; index < meshes.length; index++) {
            const mesh = meshes[index]!;
            if (!mesh.geometry.vertices.length) continue;
            let slot = buffers[index];
            if (!slot) {
              const buffer = context.createBuffer();
              if (!buffer) throw new Error("Waveform buffer unavailable");
              slot = { buffer, capacity: 0 }; buffers[index] = slot;
            }
            context.bindBuffer(context.ARRAY_BUFFER, slot.buffer);
            if (slot.geometry !== mesh.geometry) {
              if (mesh.geometry.vertices.byteLength > slot.capacity) {
                const capacity = 2 ** Math.ceil(Math.log2(Math.max(16_384, mesh.geometry.vertices.byteLength)));
                context.bufferData(context.ARRAY_BUFFER, capacity, context.DYNAMIC_DRAW);
                // Check allocations, not every draw: getError can synchronize
                // with the GPU. Reuse storage while panning/zooming.
                if (context.getError() !== context.NO_ERROR) throw new Error("Waveform allocation failed");
                slot.capacity = capacity;
              }
              context.bufferSubData(context.ARRAY_BUFFER, 0, mesh.geometry.vertices);
              slot.geometry = mesh.geometry;
            }
            context.vertexAttribPointer(point, 2, context.FLOAT, false, 0, 0);
            const rgb = Number.parseInt(mesh.color.slice(1), 16);
            context.uniform4f(color, (rgb >> 16 & 255) / 255, (rgb >> 8 & 255) / 255, (rgb & 255) / 255, 1);
            context.drawArrays(mesh.geometry.mode === "segments" ? context.LINES : context.LINE_STRIP, 0, mesh.geometry.vertices.length / 2);
          }
          // Resize/theme effects can draw outside an animation-frame callback.
          context.flush();
          return true;
        } catch { onFailure(); return false; }
      },
      dispose,
    };
  } catch { dispose(); return undefined; }
}
