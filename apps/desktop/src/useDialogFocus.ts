import { useEffect, useRef } from "react";

/** Trap keyboard focus while a modal is mounted and return it to its trigger. */
export function useDialogFocus(onClose?: () => void, enabled = true) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!enabled || !ref.current) return;
    const dialog = ref.current;
    const previous = document.activeElement;
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(item => item.getClientRects().length > 0);
    const focus = requestAnimationFrame(() => (focusable()[0] ?? dialog).focus());
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape" && close.current) { event.preventDefault(); close.current(); }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keydown);
    return () => { cancelAnimationFrame(focus); document.removeEventListener("keydown", keydown); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [enabled]);
  return ref;
}
