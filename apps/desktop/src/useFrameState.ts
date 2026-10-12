import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFrameQueue } from "./chart-rendering";

export function useFrameState<T>(initial: T) {
  const [value, setValue] = useState(initial);
  const latest = useRef(initial);
  const queue = useMemo(() => createFrameQueue<T>(callback => requestAnimationFrame(callback), cancelAnimationFrame, setValue), []);
  useEffect(() => () => queue.cancel(), [queue]);
  const update = useCallback((next: T) => { latest.current = next; queue.push(next); }, [queue]);
  const getLatest = useCallback(() => latest.current, []);
  return [value, update, getLatest] as const;
}
