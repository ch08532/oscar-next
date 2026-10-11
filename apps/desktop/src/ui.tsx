import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { Card } from "./components/tremor/Card";
import { Badge } from "./components/tremor/Badge";
export { Card, Badge };

export function CalculatingIndicator() {
  return <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-sm text-[var(--muted)]" role="status">
    <LoaderCircle size={24} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
    <span>Calculating…</span>
  </div>;
}

export function MetricCard({ label, value, unit, detail }: { label: string; value: ReactNode; unit?: string; detail?: ReactNode }) {
  return <Card className="metric border-[var(--border)] bg-[var(--surface)] p-4 shadow-none dark:border-[var(--border)] dark:bg-[var(--surface)]">
    <span className="text-xs font-medium text-[var(--muted)]">{label}</span>
    <strong className="mt-2 block text-2xl font-semibold tracking-tight tabular-nums">{value}{unit && <small className="ml-1 text-xs font-normal text-[var(--muted)]">{unit}</small>}</strong>
    {detail && <small className="mt-2 block text-xs text-[var(--muted)]">{detail}</small>}
  </Card>;
}

export function PageIntro({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 text-sm text-[var(--muted)]">{description}</p></div>{actions}</div>;
}
