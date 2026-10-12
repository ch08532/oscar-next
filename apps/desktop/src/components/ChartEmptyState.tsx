export function ChartEmptyState({ className = "" }: { className?: string }) {
  return <div className={`pointer-events-none flex h-full w-full items-center justify-center text-sm text-[var(--muted)] ${className}`} role="status">No data</div>;
}
