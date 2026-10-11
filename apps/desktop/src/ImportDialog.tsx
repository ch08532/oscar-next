import { useDialogFocus } from "./useDialogFocus";
import type { ImportPreview, ImportProgress, ImportStoreResult } from "./types";
import { ProgressBar } from "./components/tremor/ProgressBar";
import { Badge } from "./ui";
import { X } from "lucide-react";

const FILE_TYPES = ["STR", "BRP", "PLD", "EVE", "CSL", "SAD", "SA2", "AEV"];

export function ImportDialog({
  preview,
  progress,
  result,
  importing,
  databaseOpen,
  error,
  automaticDetectionLabel,
  onImport,
  onClose,
}: {
  preview: ImportPreview;
  progress?: ImportProgress;
  result?: ImportStoreResult;
  importing: boolean;
  databaseOpen: boolean;
  error?: string;
  automaticDetectionLabel?: string;
  onImport(): void;
  onClose(): void;
}) {
  const dialogRef = useDialogFocus(importing ? undefined : onClose);
  const percent = progress?.total && progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : undefined;

  return <div className="modal-backdrop" role="presentation">
    <section ref={dialogRef} tabIndex={-1} className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="import-dialog-heading">
        <div>
          <h2 id="import-title">{automaticDetectionLabel && !result ? "CPAP card detected" : "Import CPAP data"}</h2>
          <p>{result ? "Import complete" : automaticDetectionLabel ? `${preview.machine?.brand || preview.importerName} ${preview.machine?.model || "device"} is ready to import.` : `Detected ${preview.importerName} media`}</p>
        </div>
        {!importing && <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>}
      </div>

      {automaticDetectionLabel && !result && <div className="auto-detected-note"><strong>Detected automatically</strong><span>{automaticDetectionLabel}</span></div>}
      <div className="import-source"><span>Source</span><code>{preview.sourcePath}</code></div>

      <div className="import-device-card">
        <div><span>Manufacturer</span><strong>{preview.machine?.brand || preview.importerName}</strong></div>
        <div><span>Model</span><strong>{preview.machine?.model || "Unknown"}</strong></div>
        <div><span>Model #</span><strong>{preview.machine?.modelNumber || "—"}</strong></div>
        <div><span>Serial</span><strong>{preview.machine?.serial || "—"}</strong></div>
      </div>

      {preview.fileCount !== undefined && <div className="import-files">
        <div className="import-files-heading"><strong>{preview.fileCount} EDF file{preview.fileCount === 1 ? "" : "s"} found</strong><span>Files are parsed only after you confirm.</span></div>
        <div className="file-count-grid">{FILE_TYPES.map((type) => {
          const count = preview.fileCounts?.[type] ?? 0;
          return <Badge key={type} variant={count > 0 ? "default" : "neutral"}>{type} <strong>{count}</strong></Badge>;
        })}</div>
      </div>}

      {!databaseOpen && !result && <div className="import-note">No database is open. OSCAR Next will ask where to create the SQLite database when you start the import.</div>}

      {importing && <div className="import-progress">
        <div className="progress-row"><strong>{progress?.message || "Importing therapy data…"}</strong><span>{percent !== undefined ? `${percent}%` : ""}</span></div>
        <ProgressBar value={percent ?? 0} className="my-3" aria-label="CPAP import progress" />
        {progress?.total !== undefined && <small>{progress.current} of {progress.total}</small>}
      </div>}

      {error && <div className="error">{error}</div>}

      {result && <div className="import-result">
        <div className="success"><strong>Import complete.</strong> Daily has been refreshed to the latest stored therapy night.</div>
        <div className="import-result-grid">
          <div><span>Read from card</span><strong>{result.sessionsImported}</strong></div>
          <div><span>New sessions</span><strong>{result.newSessions}</strong></div>
          <div><span>Updated sessions</span><strong>{result.updatedSessions}</strong></div>
          <div><span>Total stored</span><strong>{result.totalStoredSessions}</strong></div>
        </div>
        {result.warnings.length > 0 && <details className="import-warnings"><summary>{result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"}</summary><ul>{result.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></details>}
      </div>}

      <div className="import-actions">
        {!result && <button className="secondary" onClick={onClose} disabled={importing}>Cancel</button>}
        {!result && <button onClick={onImport} disabled={importing}>{importing ? "Importing…" : automaticDetectionLabel ? "Import this card" : "Import data"}</button>}
        {result && <button onClick={onClose}>View Daily</button>}
      </div>
    </section>
  </div>;
}
