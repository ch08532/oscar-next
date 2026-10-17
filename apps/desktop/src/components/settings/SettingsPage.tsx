import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { Moon, Sun, Monitor } from "lucide-react";
import { AISettings } from "../../AISettings";
import { GroqSettings } from "../../GroqSettings";
import { LocalAISettings } from "../../LocalAISettings";
import { Card, PageIntro } from "../../ui";
import type { ThemePreference } from "../../theme";
import { TherapyAnalysisSettings } from "../TherapyAnalysisSettings";
import type { AIProviderId } from "../../../../../src/ai/contracts.js";

const tabs = [
  { id: "general", label: "General" },
  { id: "analysis", label: "Therapy & graphs" },
  { id: "ai", label: "AI" },
  { id: "connection", label: "Connection" },
] as const;
export type SettingsTab = typeof tabs[number]["id"];

export function SettingsPage({ tab, onTabChange, machineId, profileId, deployment, theme, onTheme, provider, onProviderChange }: {
  tab: SettingsTab; onTabChange(tab: SettingsTab): void;
  machineId?: number; profileId?: number; deployment: "desktop" | "browser";
  theme: ThemePreference; onTheme(theme: ThemePreference): void;
  provider: AIProviderId; onProviderChange(provider: AIProviderId): void;
}) {
  const id = useId();
  // Keep visited panels mounted so switching tabs preserves unsaved form values.
  // AI configuration and its status polling only start after opening the AI tab.
  const [visited, setVisited] = useState<SettingsTab[]>([tab]);
  useEffect(() => { setVisited(previous => previous.includes(tab) ? previous : [...previous, tab]); }, [tab]);
  const card = "border-[var(--border)] bg-[var(--surface)] p-5 shadow-none";
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
      : event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : undefined;
    if (next === undefined) return;
    event.preventDefault();
    onTabChange(tabs[next]!.id);
    document.getElementById(`${id}-tab-${tabs[next]!.id}`)?.focus();
  }
  return <>
    <PageIntro title="Settings" description="Personalise your workspace, analysis and AI providers." />
    <div role="tablist" aria-label="Settings categories" className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-4">
      {tabs.map((item, index) => <button key={item.id} id={`${id}-tab-${item.id}`} type="button" role="tab"
        aria-selected={tab === item.id} aria-controls={`${id}-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1}
        className={tab === item.id ? "" : "secondary"} onClick={() => onTabChange(item.id)} onKeyDown={event => navigate(event, index)}>{item.label}</button>)}
    </div>
    {tabs.map(item => <div key={item.id} id={`${id}-panel-${item.id}`} role="tabpanel" aria-labelledby={`${id}-tab-${item.id}`}
      hidden={tab !== item.id} tabIndex={0}>
      {(visited.includes(item.id) || tab === item.id) && <div className="space-y-5">
        {item.id === "general" && <Card className={card}>
          <h3 className="font-semibold">Appearance</h3>
          <p className="my-3 text-sm text-[var(--muted)]">Stored on this device. Therapy timestamps and clinical data are unaffected.</p>
          <div className="flex flex-wrap gap-3">{([{ name: "dark", icon: Moon }, { name: "light", icon: Sun }, { name: "system", icon: Monitor }] as const).map(option =>
            <button key={option.name} className={theme === option.name ? "" : "secondary"} aria-pressed={theme === option.name} onClick={() => onTheme(option.name)}>
              <option.icon size={17} />{option.name[0].toUpperCase() + option.name.slice(1)}
            </button>)}</div>
        </Card>}
        {item.id === "analysis" && <>
          {machineId !== undefined ? <TherapyAnalysisSettings key={machineId} machineId={machineId} />
            : <Card className={card}><p>Select a profile and device to configure therapy analysis.</p></Card>}
          <Card className={card}><h3 className="font-semibold">Graphs</h3><p className="mt-3 text-sm text-[var(--muted)]">Pin, reorder and resize graphs directly in Daily. Layout is saved per device. Named zoom views are saved per therapy night.</p></Card>
        </>}
        {item.id === "ai" && <>
          <Card className={card}>
            <label className="block font-semibold">AI provider
              <select className="mt-3 block" aria-label="AI Provider" value={provider} onChange={event => onProviderChange(event.target.value as AIProviderId)}>
                <option value="ollama">Local Ollama</option><option value="openai">OpenAI</option><option value="groq">Groq</option>
              </select>
            </label>
            <p className="mt-3 text-sm text-[var(--muted)]">Expert uses this selection. It is saved automatically on this device. Configure the provider below, then open Expert to run an analysis.</p>
            <p className="mt-2 text-sm text-[var(--muted)]">Local Ollama processes data on the backend computer; cloud providers receive the selected measurements. Changing providers starts a separate conversation.</p>
          </Card>
          {provider === "ollama" && <LocalAISettings deployment={deployment} />}
          {provider === "openai" && <AISettings scope={profileId !== undefined && machineId !== undefined ? { profileId, machineId } : undefined} />}
          {provider === "groq" && <GroqSettings />}
        </>}
        {item.id === "connection" && <Card className={card}><h3 className="font-semibold">Headless / API</h3><p className="mt-3 text-sm text-[var(--muted)]">{deployment === "browser" ? `Connected to ${location.origin}. Network/authentication options are configured when starting the service.` : "This desktop client uses the isolated preload API. Start the headless service separately for web access."}</p></Card>}
      </div>}
    </div>)}
  </>;
}
