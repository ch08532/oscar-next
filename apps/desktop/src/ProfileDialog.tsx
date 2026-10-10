import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import type { MachineTimeSettings, ProfileSummary, StoredMachineSummary } from "./types";

const COMMON_ZONES = [
  "America/Toronto",
  "America/Vancouver",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Oslo",
  "UTC",
];

function TimeZoneInput({ value, onChange, id }: { value: string; onChange(value: string): void; id: string }) {
  return <>
    <input list={id} value={value} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)} placeholder="America/Toronto" />
    <datalist id={id}>{COMMON_ZONES.map((zone) => <option key={zone} value={zone} />)}</datalist>
  </>;
}

export function FirstRunSetup({ systemTimeZone, onComplete, onOpenExisting, onTryDemo }: {
  systemTimeZone: string;
  onComplete(name: string, timeZone: string): Promise<void>;
  onOpenExisting(): Promise<void>;
  onTryDemo(): Promise<void>;
}) {
  const [name, setName] = useState("My Profile");
  const [timeZone, setTimeZone] = useState(systemTimeZone || "UTC");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(undefined);
    try { await onComplete(name, timeZone); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  }

  return <div className="modal-backdrop setup-backdrop"><form className="modal-card setup-card" onSubmit={submit}>
    <div className="setup-brand"><span className="setup-mark">O</span><div><h2>Welcome to OSCAR Next</h2><p>Set up the profile that will own your therapy data.</p></div></div>
    <label>Profile name<input value={name} onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)} required /></label>
    <label>Home timezone<TimeZoneInput id="setup-timezones" value={timeZone} onChange={setTimeZone} /><small>CPAP timestamps are kept as device wall-clock time. This timezone gives them real-world timezone meaning without changing the source data.</small></label>
    {error && <div className="error">{error}</div>}
    <div className="dialog-actions setup-actions"><button type="button" className="secondary" onClick={() => void onOpenExisting()}>Open existing database</button><button type="button" className="secondary" disabled={saving} onClick={() => void (async () => { setSaving(true); setError(undefined); try { await onTryDemo(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setSaving(false); } })()}>{saving ? "Loading…" : "Try demo data"}</button><button type="submit" disabled={saving}>{saving ? "Working…" : "Create profile"}</button></div>
  </form></div>;
}

export function ProfileSettingsDialog({ profiles, activeProfile, machine, machineTime, onClose, onSelect, onCreate, onUpdate, onSetMachineTimeZone }: {
  profiles: ProfileSummary[];
  activeProfile?: ProfileSummary;
  machine?: StoredMachineSummary;
  machineTime?: MachineTimeSettings;
  onClose(): void;
  onSelect(id: number): Promise<void>;
  onCreate(name: string, timeZone: string): Promise<void>;
  onUpdate(id: number, updates: { name?: string; timeZone?: string }): Promise<void>;
  onSetMachineTimeZone(timeZone?: string): Promise<void>;
}) {
  const [name, setName] = useState(activeProfile?.name ?? "");
  const [timeZone, setTimeZone] = useState(activeProfile?.timeZone ?? "UTC");
  const [newName, setNewName] = useState("");
  const [newZone, setNewZone] = useState(activeProfile?.timeZone ?? "UTC");
  const [manualMachineZone, setManualMachineZone] = useState(machineTime?.source === "manual");
  const [machineZone, setMachineZone] = useState(machineTime?.deviceTimeZone ?? activeProfile?.timeZone ?? "UTC");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(activeProfile?.name ?? "");
    setTimeZone(activeProfile?.timeZone ?? "UTC");
    setNewZone(activeProfile?.timeZone ?? "UTC");
  }, [activeProfile?.id, activeProfile?.name, activeProfile?.timeZone]);

  useEffect(() => {
    setManualMachineZone(machineTime?.source === "manual");
    setMachineZone(machineTime?.deviceTimeZone ?? activeProfile?.timeZone ?? "UTC");
  }, [machineTime?.machineId, machineTime?.deviceTimeZone, machineTime?.source, activeProfile?.timeZone]);

  async function work(action: () => Promise<void>) {
    setSaving(true); setError(undefined);
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  }

  return <div className="modal-backdrop"><div className="modal-card profile-card">
    <div className="dialog-heading"><div><h2>Profiles & device time</h2><p>Keep therapy histories separate and define how each machine’s wall clock maps to a timezone.</p></div><button className="icon-button" onClick={onClose} aria-label="Close">×</button></div>

    <section className="profile-section">
      <h3>Active profile</h3>
      <label>Profile<select value={activeProfile?.id ?? ""} onChange={(event: ChangeEvent<HTMLSelectElement>) => void work(() => onSelect(Number(event.target.value)))}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
      {activeProfile && <div className="profile-fields"><label>Name<input value={name} onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)} /></label><label>Home timezone<TimeZoneInput id="profile-timezones" value={timeZone} onChange={setTimeZone} /></label><button disabled={saving} onClick={() => void work(() => onUpdate(activeProfile.id, { name, timeZone }))}>Save profile</button></div>}
    </section>

    {machine && machineTime && <section className="profile-section">
      <h3>{machine.brand} {machine.model}</h3>
      <p className="muted">Serial {machine.serial || "—"}</p>
      <label className="checkbox-row"><input type="checkbox" checked={!manualMachineZone} onChange={(event: ChangeEvent<HTMLInputElement>) => { const inherit = event.target.checked; setManualMachineZone(!inherit); if (inherit) void work(() => onSetMachineTimeZone(undefined)); }} />Use profile timezone ({activeProfile?.timeZone ?? "UTC"})</label>
      {manualMachineZone && <div className="profile-fields"><label>Device timezone<TimeZoneInput id="machine-timezones" value={machineZone} onChange={setMachineZone} /><small>Use this if the CPAP clock was set for a different location than your home profile.</small></label><button disabled={saving} onClick={() => void work(() => onSetMachineTimeZone(machineZone))}>Save device timezone</button></div>}
      <div className="timezone-status">Stored timestamps: <strong>device wall clock</strong> · Timezone: <strong>{machineTime.deviceTimeZone}</strong> · Source: <strong>{machineTime.source}</strong></div>
    </section>}

    <section className="profile-section">
      <h3>Add another profile</h3>
      <div className="profile-fields"><label>Name<input value={newName} onChange={(event: ChangeEvent<HTMLInputElement>) => setNewName(event.target.value)} placeholder="Profile name" /></label><label>Timezone<TimeZoneInput id="new-profile-timezones" value={newZone} onChange={setNewZone} /></label><button disabled={saving || !newName.trim()} onClick={() => void work(async () => { await onCreate(newName, newZone); setNewName(""); })}>Add profile</button></div>
    </section>

    {error && <div className="error">{error}</div>}
    <div className="dialog-actions"><button onClick={onClose}>Done</button></div>
  </div></div>;
}
