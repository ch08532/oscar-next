import { EVENT_PRESENTATION } from "./event-presentation.js";

interface EventSource { channelId: number; timesMs: ArrayLike<number>; values: ArrayLike<number>; }
export interface InspectorEvent { time: number; duration: number; channel: number; }

/** Only exact event channels enter this list; dense waveform buffers stay untouched. */
export function chronologicalEvents(series: readonly EventSource[]): InspectorEvent[] {
  return series.filter(item => !!EVENT_PRESENTATION[item.channelId])
    .flatMap(item => Array.from(item.timesMs, (time, index) => ({ time, duration: item.values[index] ?? 0, channel: item.channelId })))
    .sort((a, b) => a.time - b.time);
}
