import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { DEFAULT_CHART_CHANNELS } from "./channels";
import { GraphStack } from "./Charts";
import { Overview } from "./Overview";
import { Statistics } from "./Statistics";
import { ImportDialog } from "./ImportDialog";
import { FirstRunSetup, ProfileSettingsDialog } from "./ProfileDialog";
import type {
  ChartQueryResult,
  DailySummary,
  DetectedMedia,
  ImportPreview,
  ImportProgress,
  ImportStoreResult,
  AppInfo,
  MachineTimeSettings,
  ProfileSummary,
  SetupState,
  StoredMachineSummary,
} from "./types";

type AppView = "daily" | "overview" | "statistics";

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Stored therapy timestamps are floating device wall-clock values. */
function therapyDateForTimestamp(ms: number): string {
  return new Date(ms - 12 * 3_600_000).toISOString().slice(0, 10);
}

function formatDeviceTime(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16);
}

function Metric({ label, value, suffix = "" }: { label: string; value: string | number; suffix?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}{suffix}</strong></div>;
}

export function App() {
  const [view, setView] = useState<AppView>("daily");
  const [appInfo, setAppInfo] = useState<AppInfo>();
  const [setup, setSetup] = useState<SetupState>();
  const [database, setDatabase] = useState<string>();
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [activeProfile, setActiveProfileState] = useState<ProfileSummary>();
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [machines, setMachines] = useState<StoredMachineSummary[]>([]);
  const [machineId, setMachineId] = useState<number>();
  const [machineTime, setMachineTime] = useState<MachineTimeSettings>();
  const [date, setDate] = useState(todayKey());
  const [daily, setDaily] = useState<DailySummary>();
  const [charts, setCharts] = useState<ChartQueryResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [dataRevision, setDataRevision] = useState(0);
  const [importPreview, setImportPreview] = useState<ImportPreview>();
  const [importProgress, setImportProgress] = useState<ImportProgress>();
  const [importResult, setImportResult] = useState<ImportStoreResult>();
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string>();
  const [automaticDetectionLabel, setAutomaticDetectionLabel] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const machine = useMemo(() => machines.find((item) => item.id === machineId), [machines, machineId]);

  async function loadProfileMachines(profile?: ProfileSummary, preferredMachineId?: number) {
    if (!profile) {
      setMachines([]); setMachineId(undefined); setMachineTime(undefined); return;
    }
    const found = await window.oscar.listMachines(profile.id);
    setMachines(found);
    const preferred = preferredMachineId !== undefined ? found.find((item) => item.id === preferredMachineId) : undefined;
    const next = preferred ?? found[0];
    setMachineId(next?.id);
    if (next?.lastSessionTime !== undefined) setDate(therapyDateForTimestamp(next.lastSessionTime));
  }

  async function refreshSetup(preferredMachineId?: number) {
    const state = await window.oscar.getSetupState();
    setSetup(state);
    setDatabase(state.databasePath);
    setProfiles(state.profiles);
    setActiveProfileState(state.activeProfile);
    if (state.databasePath && state.activeProfile) await loadProfileMachines(state.activeProfile, preferredMachineId);
    else { setMachines([]); setMachineId(undefined); setMachineTime(undefined); }
    return state;
  }

  async function createDiagnostics() {
    try {
      setError(undefined); setNotice(undefined);
      const path = await window.oscar.createDiagnosticBundle();
      if (path) setNotice("Diagnostic bundle created. It contains logs and anonymized environment metadata only; therapy data and the database are not included.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function openDatabase() {
    try {
      setError(undefined);
      const path = await window.oscar.openDatabase();
      if (!path) return;
      await refreshSetup();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function completeSetup(name: string, timeZone: string) {
    const state = await window.oscar.completeSetup(name, timeZone);
    setSetup(state); setDatabase(state.databasePath); setProfiles(state.profiles); setActiveProfileState(state.activeProfile);
    await loadProfileMachines(state.activeProfile);
  }

  async function selectProfile(profileId: number) {
    await window.oscar.setActiveProfile(profileId);
    const state = await window.oscar.getSetupState();
    setSetup(state); setProfiles(state.profiles); setActiveProfileState(state.activeProfile);
    await loadProfileMachines(state.activeProfile);
    setDataRevision((value) => value + 1);
  }

  async function createProfile(name: string, timeZone: string) {
    const profile = await window.oscar.createProfile(name, timeZone);
    await selectProfile(profile.id);
  }

  async function updateProfile(id: number, updates: { name?: string; timeZone?: string }) {
    await window.oscar.updateProfile(id, updates);
    const preferred = machineId;
    const state = await window.oscar.getSetupState();
    setSetup(state); setProfiles(state.profiles); setActiveProfileState(state.activeProfile);
    await loadProfileMachines(state.activeProfile, preferred);
    if (preferred !== undefined) setMachineTime(await window.oscar.getMachineTimeSettings(preferred));
    setDataRevision((value) => value + 1);
  }

  async function setCurrentMachineTimeZone(timeZone?: string) {
    if (machineId === undefined) return;
    const next = await window.oscar.setMachineTimeZone(machineId, timeZone);
    setMachineTime(next);
    const found = activeProfile ? await window.oscar.listMachines(activeProfile.id) : [];
    setMachines(found);
    setDataRevision((value) => value + 1);
  }

  async function loadDemoData() {
    setImporting(true); setError(undefined); setNotice(undefined);
    try {
      const result = await window.oscar.loadDemoData();
      setDatabase(result.databasePath);
      await refreshSetup(result.machineId);
      if (result.lastSessionTime !== undefined) setDate(therapyDateForTimestamp(result.lastSessionTime));
      setView("daily"); setDataRevision((value) => value + 1);
      setNotice("Demo therapy data loaded. This dataset is synthetic and contains no real patient information.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setImporting(false); }
  }

  async function chooseImportSource() {
    try {
      setImportError(undefined); setImportResult(undefined); setImportProgress(undefined); setAutomaticDetectionLabel(undefined);
      const preview = await window.oscar.chooseImportSource();
      if (preview) setImportPreview(preview);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function runImport() {
    if (!importPreview) return;
    setImporting(true); setImportError(undefined); setImportResult(undefined);
    try {
      const result = await window.oscar.runImport(importPreview.sourcePath, activeProfile?.id);
      if (!result) { setImporting(false); return; }
      setImportResult(result); setDatabase(result.databasePath);
      const state = await window.oscar.getSetupState();
      setSetup(state); setProfiles(state.profiles); setActiveProfileState(state.activeProfile);
      await loadProfileMachines(state.activeProfile, result.machineId);
      if (result.lastSessionTime !== undefined) setDate(therapyDateForTimestamp(result.lastSessionTime));
      setView("daily"); setDataRevision((value) => value + 1);
    } catch (cause) { setImportError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setImporting(false); }
  }

  function closeImportDialog() {
    if (importing) return;
    setImportPreview(undefined); setImportProgress(undefined); setImportResult(undefined); setImportError(undefined); setAutomaticDetectionLabel(undefined);
  }

  function selectMachine(nextMachineId: number) {
    setMachineId(nextMachineId);
    const nextMachine = machines.find((item) => item.id === nextMachineId);
    if (nextMachine?.lastSessionTime !== undefined) setDate(therapyDateForTimestamp(nextMachine.lastSessionTime));
  }

  async function setSessionEnabled(sessionId: number, enabled: boolean) {
    if (machineId === undefined) return;
    try { setError(undefined); await window.oscar.setSessionEnabled(machineId, sessionId, enabled); setDataRevision((value) => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  useEffect(() => { void window.oscar.getAppInfo().then(setAppInfo).catch(() => undefined); void refreshSetup().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))); }, []);
  useEffect(() => window.oscar.onImportProgress((progress) => setImportProgress(progress)), []);

  useEffect(() => {
    const showDetectedMedia = (detected: DetectedMedia) => {
      setImportProgress(undefined); setImportResult(undefined); setImportError(undefined);
      setAutomaticDetectionLabel(detected.volume.label ? `${detected.volume.label} (${detected.volume.rootPath})` : detected.volume.rootPath);
      setImportPreview(detected.preview);
    };
    const unsubscribe = window.oscar.onMediaDetected(showDetectedMedia);
    void window.oscar.getPendingDetectedMedia().then((detected) => { if (detected) showDetectedMedia(detected); });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (machineId === undefined) { setMachineTime(undefined); return; }
    let cancelled = false;
    void window.oscar.getMachineTimeSettings(machineId).then((value) => { if (!cancelled) setMachineTime(value); }).catch(() => { if (!cancelled) setMachineTime(undefined); });
    return () => { cancelled = true; };
  }, [machineId, dataRevision]);

  useEffect(() => {
    if (machineId === undefined || view !== "daily") return;
    let cancelled = false;
    setLoading(true); setError(undefined);
    Promise.all([
      window.oscar.getDaily(machineId, date),
      window.oscar.getChartSeries(machineId, date, [...DEFAULT_CHART_CHANNELS], { maxPointsPerSeries: 4_000 }),
    ]).then(([nextDaily, nextCharts]) => {
      if (cancelled) return;
      setDaily(nextDaily); setCharts(nextCharts);
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [machineId, date, view, dataRevision]);

  const needsSetup = setup?.needsSetup === true;

  return <div className="app-shell">
    <header>
      <div><h1>OSCAR Next</h1><p>CPAP therapy analysis{appInfo ? ` · v${appInfo.version}` : ""}</p></div>
      <div className="header-actions">
        {database && activeProfile && <label className="header-profile">Profile<select value={activeProfile.id} onChange={(event: ChangeEvent<HTMLSelectElement>) => void selectProfile(Number(event.target.value))}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>}
        {database && <button className="header-secondary" onClick={() => setShowProfileSettings(true)}>Profiles & time</button>}
        <button className="header-secondary" onClick={() => void createDiagnostics()}>Diagnostics</button>
        <button className="header-secondary" onClick={chooseImportSource}>Import data</button>
        <button onClick={openDatabase}>{database ? "Change database" : "Open database"}</button>
      </div>
    </header>

    <nav>
      <button className={view === "daily" ? "active" : ""} onClick={() => setView("daily")}>Daily</button>
      <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")} disabled={!database}>Overview</button>
      <button className={view === "statistics" ? "active" : ""} onClick={() => setView("statistics")} disabled={!database}>Statistics</button>
    </nav>

    <main>
      {notice && <div className="notice">{notice}</div>}
      {!database && !needsSetup && <section className="empty"><h2>Open a database or import your CPAP card</h2><p>You can open an existing OSCAR Next database, or import directly from an SD card/backup folder and create one.</p><div className="empty-actions"><button onClick={chooseImportSource}>Import CPAP data</button><button className="secondary" onClick={openDatabase}>Open database</button></div></section>}
      {database && <>
        <section className="toolbar">
          <label>Machine<select value={machineId ?? ""} onChange={(event: ChangeEvent<HTMLSelectElement>) => selectMachine(Number(event.target.value))}>{machines.map((item) => <option key={item.id} value={item.id}>{item.brand} {item.model}</option>)}</select></label>
          {view === "daily" && <label>Therapy date<input type="date" value={date} onChange={(event: ChangeEvent<HTMLInputElement>) => setDate(event.target.value)} /></label>}
          {view !== "daily" && <div className="toolbar-view-title"><strong>{view === "overview" ? "Overview" : "Statistics"}</strong><span>{view === "overview" ? "Long-term therapy trends" : "Long-term summary tables"}</span></div>}
          <div className="device"><strong>{machine?.brand} {machine?.model}</strong><span>{machine?.serial ? `Serial ${machine.serial}` : ""}</span><span>{machineTime ? `Device time · ${machineTime.deviceTimeZone}` : ""}</span></div>
        </section>

        {machines.length === 0 && <section className="empty profile-empty"><h2>No machines in {activeProfile?.name ?? "this profile"}</h2><p>Import a CPAP card to add therapy data to this profile.</p><div className="empty-actions"><button onClick={chooseImportSource}>Import CPAP data</button><button className="secondary" disabled={importing} onClick={() => void loadDemoData()}>{importing ? "Loading demo…" : "Load demo data"}</button></div></section>}

        {view === "daily" && machineId !== undefined && <>
          {error && <div className="error">{error}</div>}
          {loading && <div className="loading">Loading therapy data…</div>}
          {daily && <>
            <section className="metrics">
              <Metric label="Usage" value={daily.usageHours.toFixed(2)} suffix=" h" />
              <Metric label="AHI" value={daily.ahi.toFixed(2)} />
              <Metric label="RDI" value={daily.rdi.toFixed(2)} />
              <Metric label="Pressure 95%" value={daily.pressure?.percentile95.toFixed(1) ?? "—"} suffix={daily.pressure ? " cmH₂O" : ""} />
              <Metric label="Leak 95%" value={daily.leak?.percentile95.toFixed(1) ?? "—"} suffix={daily.leak ? " L/min" : ""} />
            </section>

            <section className="content-grid">
              <article className="panel events"><h2>Events</h2>{daily.sessions.some((session) => session.enabled !== false && session.summaryOnly)
                ? <><p>Summary-only data: event tiles show indices per therapy hour.</p><div className="event-grid"><Metric label="OA index" value={daily.eventIndices.obstructive.toFixed(2)} /><Metric label="CA index" value={daily.eventIndices.clearAirway.toFixed(2)} /><Metric label="H index" value={daily.eventIndices.hypopnea.toFixed(2)} /><Metric label="UA index" value={daily.eventIndices.unclassified.toFixed(2)} /><Metric label="RERA index" value={daily.eventIndices.rera.toFixed(2)} /></div></>
                : <div className="event-grid"><Metric label="Obstructive" value={daily.eventCounts.obstructive} /><Metric label="Central" value={daily.eventCounts.clearAirway} /><Metric label="Hypopnea" value={daily.eventCounts.hypopnea} /><Metric label="Unclassified" value={daily.eventCounts.unclassified} /><Metric label="RERA" value={daily.eventCounts.rera} /></div>}
              </article>

              <article className="panel sessions-panel"><div className="panel-heading-row"><div><h2>Sessions</h2><p>Times are the CPAP device wall clock ({daily.deviceTimeZone}). Disabled sessions are excluded from calculations, trends, and graphs.</p></div></div>{daily.sessions.length === 0 ? <p>No therapy sessions for this day.</p> : <table><thead><tr><th>Included</th><th>Start</th><th>End</th><th>Usage</th><th>Data</th></tr></thead><tbody>{daily.sessions.map((session) => <tr key={session.id} className={session.enabled === false ? "session-disabled" : ""}><td><label className="session-toggle"><input type="checkbox" checked={session.enabled !== false} onChange={(event: ChangeEvent<HTMLInputElement>) => void setSessionEnabled(session.id, event.target.checked)} /><span>{session.enabled === false ? "Off" : "On"}</span></label></td><td>{formatDeviceTime(session.firstMs)}</td><td>{formatDeviceTime(session.lastMs)}</td><td>{session.usageHours.toFixed(2)} h</td><td>{session.summaryOnly ? "Summary" : "Detailed"}</td></tr>)}</tbody></table>}</article>

              <article className="panel graphs-panel"><div className="graphs-title"><div><h2>Therapy Graphs</h2><p>Synchronized detailed signals in device wall-clock time.</p></div><span>{daily.availableChannels.length} stored channels</span></div>{charts ? <GraphStack data={charts} daily={daily} /> : <div className="graph-empty">Chart data is loading…</div>}</article>
            </section>
          </>}
        </>}

        {view === "overview" && machine && machineId !== undefined && <Overview machine={machine} machineId={machineId} defaultEndDate={date} />}
        {view === "statistics" && machine && machineId !== undefined && <Statistics machine={machine} machineId={machineId} defaultEndDate={date} />}
      </>}
    </main>

    {setup && needsSetup && <FirstRunSetup systemTimeZone={setup.systemTimeZone} onComplete={completeSetup} onOpenExisting={openDatabase} onTryDemo={loadDemoData} />}
    {showProfileSettings && database && <ProfileSettingsDialog profiles={profiles} activeProfile={activeProfile} machine={machine} machineTime={machineTime} onClose={() => setShowProfileSettings(false)} onSelect={selectProfile} onCreate={createProfile} onUpdate={updateProfile} onSetMachineTimeZone={setCurrentMachineTimeZone} />}
    {importPreview && <ImportDialog preview={importPreview} progress={importProgress} result={importResult} importing={importing} databaseOpen={Boolean(database)} error={importError} automaticDetectionLabel={automaticDetectionLabel} onImport={runImport} onClose={closeImportDialog} />}
  </div>;
}
