import { useEffect, useState } from "react";
import type { TherapyAnalysisPreferences } from "../types";
import { Card } from "../ui";

export function TherapyAnalysisSettings({ machineId }: { machineId: number }) {
  const [preferences, setPreferences] = useState<TherapyAnalysisPreferences>();
  const [threshold, setThreshold] = useState("");
  const [showLine, setShowLine] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    setPreferences(undefined); setError(undefined); setMessage(undefined);
    window.oscar.getTherapyAnalysisPreferences(machineId).then(value => {
      if (!cancelled) { setPreferences(value); setThreshold(String(value.leakThreshold)); setShowLine(value.showLeakThreshold); }
    }).catch(cause => { if (!cancelled) setError(String(cause)); });
    return () => { cancelled = true; };
  }, [machineId]);
  return <Card className="border-[var(--border)] bg-[var(--surface)] p-5 shadow-none dark:border-[var(--border)] dark:bg-[var(--surface)]">
    <h3 className="font-semibold">Therapy Analysis</h3><p className="my-3 text-sm text-[var(--muted)]">Saved per device. The ResMed default large leak threshold is 24 L/min.</p>
    <form onSubmit={event => {
      event.preventDefault(); setSaving(true); setError(undefined); setMessage(undefined);
      void window.oscar.setTherapyAnalysisPreferences(machineId, { leakThreshold: Number(threshold), showLeakThreshold: showLine })
        .then(value => { setPreferences(value); setMessage("Therapy analysis settings saved."); })
        .catch(cause => setError(String(cause))).finally(() => setSaving(false));
    }} className="space-y-3">
      <label className="block text-sm">Large Leak Threshold (L/min)<input type="number" min="0" max="1000" step="any" required value={threshold} disabled={!preferences || saving} onChange={event => setThreshold(event.target.value)} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" style={{ width: "auto" }} checked={showLine} disabled={!preferences || saving} onChange={event => setShowLine(event.target.checked)} />Show threshold on Leak graph</label>
      <button type="submit" disabled={!preferences || saving}>{saving ? "Saving…" : "Save analysis settings"}</button>
    </form>
    {message && <p className="mt-3 text-sm" role="status">{message}</p>}{error && <p className="error" role="alert">{error}</p>}
  </Card>;
}
