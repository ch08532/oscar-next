import { Expert } from "./Expert";
import type { EvidenceReference } from "../../../src/expert/schemas.js";
import { TopBarActions } from "./components/TopBarActions";
import { useEffect, useMemo, useRef, useState, lazy, Suspense, type ChangeEvent } from "react";
import { selectedChartChannels } from "./daily-graphs";
import { GraphStack } from "./Charts";
const Overview = lazy(() => import("./Overview").then(module => ({ default: module.Overview })));
import { Statistics } from "./Statistics";
import { ImportDialog } from "./ImportDialog";
import { FirstRunSetup, ProfileSettingsDialog } from "./ProfileDialog";
import { Sidebar, type AppView } from "./components/Sidebar";
import { NightInspector, type GraphNavigation } from "./components/NightInspector";
import { SessionsTable } from "./components/SessionsTable";
import { AdminPages } from "./components/AdminPages";
import type { SettingsTab } from "./components/settings/SettingsPage";
import { useAIProvider } from "./components/settings/useAIProvider";
import { Card } from "./ui";
import { useTheme } from "./theme";
import { dateAtOffset } from "./overview-date-range";
import { ChevronLeft, ChevronRight, Download, Moon, Sun, PanelRightOpen, CalendarDays } from "lucide-react";
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
  GraphBookmark,
  GraphPreference,
} from "./types";

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

export function App({ deployment = "desktop" }: { deployment?: "desktop" | "browser" }) {
  const { theme, setTheme } = useTheme();
  const { provider: aiProvider, selectProvider: selectAIProvider } = useAIProvider();
  const [historyToolbar, setHistoryToolbar] = useState<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const update = () => document.documentElement.style.setProperty("--workspace-header-height", `${header.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(update);
    observer.observe(header);
    update();
    return () => { observer.disconnect(); document.documentElement.style.removeProperty("--workspace-header-height"); };
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [graphBookmarks, setGraphBookmarks] = useState<GraphBookmark[]>([]);
  const [bookmarkRevision, setBookmarkRevision] = useState(0);
  const [graphNavigation, setGraphNavigation] = useState<GraphNavigation>();
  const [pendingEvidence, setPendingEvidence] = useState<EvidenceReference>();
  const [view, setView] = useState<AppView>("daily");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
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
  const [initialGraphPreferences, setInitialGraphPreferences] = useState<GraphPreference[]>([]);
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
    if (machineId === undefined || (view !== "daily" && view !== "sessions")) return;
    let cancelled = false;
    setLoading(true); setError(undefined);
    setDaily(undefined); setCharts(undefined); setGraphBookmarks([]); setGraphNavigation(undefined);
    Promise.all([
      window.oscar.getDaily(machineId, date),
      window.oscar.getGraphPreferences(machineId),
    ]).then(async ([nextDaily, preferences]) => {
      if (cancelled) return;
      const channels = selectedChartChannels(nextDaily.availableChannels, preferences);
      const nextCharts = channels.length ? await window.oscar.getChartSeries(machineId, date, channels, { maxPointsPerSeries: 4_000 })
        : { machineId, date, rangeStartMs: nextDaily.rangeStartMs, rangeEndMs: nextDaily.rangeEndMs, series: [] };
      if (cancelled) return;
      setInitialGraphPreferences(preferences);
      setDaily(nextDaily); setCharts(nextCharts);
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [machineId, date, view, dataRevision]);

  useEffect(() => {
    if (pendingEvidence && (pendingEvidence.profileId !== activeProfile?.id || pendingEvidence.machineId !== machineId)) { setPendingEvidence(undefined); return; }
    if (!pendingEvidence || view !== "daily" || !daily || !charts || daily.date !== (pendingEvidence.date ?? pendingEvidence.startDate)) return;
    if (pendingEvidence.startMs !== undefined && pendingEvidence.endMs !== undefined) setGraphNavigation({ startMs:pendingEvidence.startMs,endMs:pendingEvidence.endMs,requestId:Date.now() });
    setPendingEvidence(undefined);
  },[pendingEvidence,view,daily,charts,activeProfile?.id,machineId]);
  const needsSetup = setup?.needsSetup === true;
  const showInspector = inspectorOpen && view === "daily" && daily !== undefined && daily.sessions.length > 0 && machineId !== undefined;

  return <div className={`app-shell grid min-h-screen max-[1150px]:grid-cols-[72px_minmax(0,1fr)] ${sidebarCollapsed ? "sidebar-compact grid-cols-[72px_minmax(0,1fr)]" : "grid-cols-[228px_minmax(0,1fr)]"}`}>
    <a href="#workspace" className="skip-link">Skip to workspace</a>
    <Sidebar view={view} onNavigate={setView} onImport={chooseImportSource} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} profile={activeProfile} version={appInfo?.version} />
    <div className="workspace-shell min-w-0">
      <header ref={headerRef} className="workspace-header sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]">
        <div className="workspace-header-main flex min-h-[76px] flex-wrap items-center justify-between gap-2.5 px-5 py-3 max-[1150px]:px-3.5">
        <div className="page-title"><small>THERAPY ANALYSIS</small><h1>{view === "api" ? "API / Swagger" : view[0].toUpperCase() + view.slice(1)}</h1></div>
        <div className="header-controls">
          {(view === "daily" || view === "sessions") && database && <div className="date-navigation"><button className="icon-button" aria-label="Previous therapy day" title="Previous therapy day" onClick={() => setDate(dateAtOffset(date, -1))}><ChevronLeft size={16} /></button><label className="date-field"><CalendarDays size={15} /><span className="sr-only">Therapy date</span><input type="date" value={date} onChange={event => { if (event.target.value) setDate(event.target.value); }} /></label><button className="icon-button" aria-label="Next therapy day" title="Next therapy day" onClick={() => setDate(dateAtOffset(date, 1))}><ChevronRight size={16} /></button><button className="secondary" disabled={machine?.lastSessionTime === undefined} onClick={() => { if (machine?.lastSessionTime !== undefined) setDate(therapyDateForTimestamp(machine.lastSessionTime)); }}>Latest</button></div>}
          {database && <label className="machine-select"><span className="sr-only">Machine</span><select value={machineId ?? ""} aria-label="Machine" onChange={event => selectMachine(Number(event.target.value))}>{machines.length === 0 && <option value="">No devices</option>}{machines.map(item => <option key={item.id} value={item.id}>{item.brand} {item.model}</option>)}</select></label>}
          <button className="import-button" onClick={chooseImportSource}><Download size={15} /><span>Import Data</span></button>
          <button className="icon-button" title="Toggle light/dark theme" aria-label="Toggle light/dark theme" onClick={() => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark")}>{theme === "light" ? <Moon size={17} /> : <Sun size={17} />}</button>
          {view === "daily" && <button className="icon-button" aria-label={showInspector ? "Hide Night Inspector" : "Show Night Inspector"} aria-expanded={showInspector} aria-controls="night-inspector" disabled={!daily?.sessions.length} onClick={() => setInspectorOpen(!inspectorOpen)} title="Night Inspector"><PanelRightOpen size={17} /></button>}
          <TopBarActions><button onClick={openDatabase}>{database ? "Change database" : "Open database"}</button><button disabled={importing} onClick={() => void loadDemoData()}>Load demo data</button><button onClick={() => setView("profiles")}>Profiles & time</button><button onClick={() => setView("diagnostics")}>Diagnostics</button></TopBarActions>
        </div>
        </div>
        {(view === "overview" || view === "statistics") && <div ref={setHistoryToolbar} className="history-toolbar w-full min-w-0 border-t border-[var(--border)] px-5 pt-2 pb-3 max-[1150px]:px-3.5" />}
      </header>
      <div className={`workspace-body ${showInspector ? "with-inspector" : ""}`}>
      <main id="workspace" className="workspace-content min-w-0 px-5 pt-[18px] pb-10 max-[1150px]:p-3.5" tabIndex={-1}>
        {notice && <div className="notice" role="status">{notice}</div>}
        {error && <div className="error" role="alert">{error}</div>}
        {!database && !needsSetup && <section className="empty"><h2>Open your therapy workspace</h2><p>Open an existing OSCAR Next database or import a CPAP card.</p><div className="empty-actions"><button onClick={chooseImportSource}>Import Data</button><button className="secondary" onClick={openDatabase}>Open database</button></div></section>}
        {database && machines.length === 0 && <section className="empty"><h2>No devices in {activeProfile?.name ?? "this profile"}</h2><p>Import a CPAP card or explore the synthetic demo.</p><div className="empty-actions"><button onClick={chooseImportSource}>Import Data</button><button className="secondary" disabled={importing} onClick={() => void loadDemoData()}>Try demo data</button></div></section>}
        {(view === "daily" || view === "sessions") && machineId !== undefined && <>
          {loading && <div className="loading-skeleton" role="status" aria-label="Loading therapy data"><span /><span /><span /></div>}
          {daily && view === "sessions" && <><div className="mb-4"><h2 className="text-lg font-semibold">Sessions · {daily.date}</h2><p className="mt-1 text-sm text-[var(--muted)]">{machine?.brand} {machine?.model} · Device wall-clock time ({daily.deviceTimeZone})</p></div><Card className="panel"><SessionsTable daily={daily} onToggle={(id, enabled) => void setSessionEnabled(id, enabled)} /></Card></>}
          {daily && view === "daily" && daily.sessions.length === 0 && <section className="empty" aria-labelledby="daily-empty-title" role="status">
            <h2 id="daily-empty-title">No therapy data for this day</h2>
            <p>No sessions have been imported for {daily.date} on this device. Choose another date or import your CPAP data.</p>
            <div className="empty-actions"><button className="secondary" disabled={machine?.lastSessionTime === undefined} onClick={() => { if (machine?.lastSessionTime !== undefined) setDate(therapyDateForTimestamp(machine.lastSessionTime)); }}>Go to latest night</button></div>
          </section>}
          {daily && view === "daily" && daily.sessions.length > 0 && <>
            <div className="daily-workspace min-w-0">
              <Card className="graphs-panel min-w-0 border-[var(--border)] bg-[var(--surface)] p-0 shadow-none dark:border-[var(--border)] dark:bg-[var(--surface)]"><div className="graphs-title"><div><h2>Waveform workspace</h2><p>Synchronised signals · device wall-clock time</p></div><span>{daily.availableChannels.length} stored channels</span></div>{charts ? <GraphStack data={charts} daily={daily} initialPreferences={initialGraphPreferences} navigation={graphNavigation} bookmarkRevision={bookmarkRevision} onBookmarksChange={setGraphBookmarks} /> : <div className="graph-empty">Loading chart data…</div>}</Card>
            </div>
          </>}
        </>}
        {view === "overview" && machine && machineId !== undefined && <Suspense fallback={<div className="loading" role="status">Loading analytics…</div>}><Overview machine={machine} machineId={machineId} defaultEndDate={date} toolbarTarget={historyToolbar} /></Suspense>}
        {view === "statistics" && machine && machineId !== undefined && <Statistics machine={machine} machineId={machineId} defaultEndDate={date} toolbarTarget={historyToolbar} />}
        {view === "expert" && activeProfile && machineId !== undefined && <Expert provider={aiProvider} key={activeProfile.id + ":" + machineId} profileId={activeProfile.id} machineId={machineId} date={date} onSettings={() => { setSettingsTab("ai"); setView("settings"); }} onEvidence={evidence => { if (evidence.profileId !== activeProfile.id || evidence.machineId !== machineId) { setError("Evidence belongs to a different selected scope"); return; } setDate(evidence.date ?? evidence.startDate ?? date); setDaily(undefined); setCharts(undefined); setPendingEvidence(evidence); setView("daily"); }} />}
        {!["expert", "daily", "overview", "statistics", "sessions"].includes(view) && <AdminPages aiProvider={aiProvider} onAIProviderChange={selectAIProvider} settingsTab={settingsTab} onSettingsTabChange={setSettingsTab} view={view} machines={machines} machineId={machineId} profileId={activeProfile?.id} onSelectMachine={selectMachine} onProfiles={() => setShowProfileSettings(true)} onImport={chooseImportSource} onDiagnostics={() => void createDiagnostics()} onStatistics={() => setView("statistics")} appInfo={appInfo} deployment={deployment} theme={theme} onTheme={setTheme} />}
      </main>
      {showInspector && <button className="inspector-shade" aria-label="Dismiss Night Inspector" onClick={() => setInspectorOpen(false)} />}{showInspector && <NightInspector key={`${machineId}-${daily.date}`} daily={daily} charts={charts} onClose={() => setInspectorOpen(false)} onToggleSession={(id, enabled) => void setSessionEnabled(id, enabled)} onDate={setDate} bookmarks={graphBookmarks} onBookmarkDelete={id => { void window.oscar.deleteGraphBookmark(machineId, id).then(() => setBookmarkRevision(value => value + 1)).catch(cause => setError(String(cause))); }} onNavigate={(startMs, endMs) => setGraphNavigation({ startMs, endMs, requestId: Date.now() })} />}
      </div>
    </div>
    {setup && needsSetup && <FirstRunSetup systemTimeZone={setup.systemTimeZone} onComplete={completeSetup} onOpenExisting={openDatabase} onTryDemo={loadDemoData} />}
    {showProfileSettings && database && <ProfileSettingsDialog profiles={profiles} activeProfile={activeProfile} machine={machine} machineTime={machineTime} onClose={() => setShowProfileSettings(false)} onSelect={selectProfile} onCreate={createProfile} onUpdate={updateProfile} onSetMachineTimeZone={setCurrentMachineTimeZone} />}
    {importPreview && <ImportDialog preview={importPreview} progress={importProgress} result={importResult} importing={importing} databaseOpen={Boolean(database)} error={importError} automaticDetectionLabel={automaticDetectionLabel} onImport={runImport} onClose={closeImportDialog} />}
  </div>;
}
