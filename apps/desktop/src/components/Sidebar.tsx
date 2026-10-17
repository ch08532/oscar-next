import { BrainCircuit, Activity, CalendarDays, ChartNoAxesCombined, ChartBar, FileText, Rows3, Download, HardDrive, UserRound, Settings, Code2, ClipboardCheck, PanelLeftClose, PanelLeftOpen, type LucideIcon } from "lucide-react";
import type { ProfileSummary } from "../types";

export type AppView = "expert" | "daily" | "overview" | "statistics" | "reports" | "sessions" | "devices" | "profiles" | "settings" | "api" | "diagnostics";
const groups: { label: string; items: { view?: AppView; label: string; icon: LucideIcon; action?: "import" }[] }[] = [
  { label: "Therapy", items: [{ view: "daily", label: "Daily", icon: CalendarDays }, { view: "overview", label: "Overview", icon: ChartNoAxesCombined }, { view: "statistics", label: "Statistics", icon: ChartBar }] },
  { label: "Analysis", items: [{ view: "expert", label: "Expert", icon: BrainCircuit }, { view: "reports", label: "Reports", icon: FileText }, { view: "sessions", label: "Sessions", icon: Rows3 }] },
  { label: "Data", items: [{ action: "import", label: "Import Data", icon: Download }, { view: "devices", label: "Devices", icon: HardDrive }] },
  { label: "System", items: [{ view: "profiles", label: "Profiles", icon: UserRound }, { view: "settings", label: "Settings", icon: Settings }, { view: "api", label: "API / Swagger", icon: Code2 }, { view: "diagnostics", label: "Diagnostics", icon: ClipboardCheck }] },
];

export function Sidebar({ view, onNavigate, onImport, collapsed, onToggle, profile, version }: {
  view: AppView; onNavigate(view: AppView): void; onImport(): void;
  collapsed: boolean; onToggle(): void; profile?: ProfileSummary; version?: string;
}) {
  return <aside className={`app-sidebar sticky top-0 flex h-screen flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--sidebar)] ${collapsed ? "is-collapsed" : ""}`} aria-label="Application sidebar">
    <div className="sidebar-brand"><span className="brand-mark"><Activity size={23} /></span><div className="sidebar-text"><strong>OSCAR <span className="text-blue-400">Next</span></strong><small>THERAPY WORKSTATION</small></div></div>
    <nav aria-label="Main navigation" className="flex-1 space-y-5 px-3 py-4">
      {groups.map(group => <div key={group.label}><p className="nav-group sidebar-text">{group.label}</p><div className="space-y-1">{group.items.map(item => <button key={item.label} title={item.label} aria-label={item.label} aria-current={item.view === view ? "page" : undefined} className={`nav-item ${item.view === view ? "nav-active" : ""}`} onClick={() => item.view ? onNavigate(item.view) : onImport()}><item.icon size={18} strokeWidth={1.7} /><span className="sidebar-text">{item.label}</span></button>)}</div></div>)}
    </nav>
    <div className="sidebar-footer"><button className="profile-nav" onClick={() => onNavigate("profiles")} title="Profiles"><span className="avatar">{profile?.name.slice(0, 1).toUpperCase() || "O"}</span><div className="sidebar-text"><strong>{profile?.name || "No profile"}</strong><small>{profile?.timeZone || "Set up a profile"}</small></div></button><div className="flex items-center justify-between gap-2"><small className="sidebar-text text-[var(--muted)]">v{version || "…"}</small><button className="icon-button" onClick={onToggle} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button></div></div>
  </aside>;
}
