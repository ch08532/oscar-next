import { useEffect, useRef, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

export function TopBarActions({ children }: { children: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) {
        menu.current?.removeAttribute("open");
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !menu.current?.open) return;
      event.preventDefault();
      menu.current.open = false;
      menu.current.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, []);

  return <details ref={menu} className="header-menu">
    <summary aria-label="More actions" title="More actions"><MoreHorizontal size={19} /></summary>
    <div onClickCapture={event => {
      // Close before an action opens a native dialog or changes the current page.
      if (event.target instanceof Element && event.target.closest("button:not(:disabled)")) {
        if (menu.current) {
          menu.current.open = false;
          menu.current.querySelector("summary")?.focus();
        }
      }
    }}>{children}</div>
  </details>;
}
