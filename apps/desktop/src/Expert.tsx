import { useEffect, useState } from "react";
import { ExpertAnalysis } from "./ExpertAnalysis";
import type { AIProviderId } from "../../../src/ai/contracts.js";
import type { EvidenceReference } from "../../../src/expert/schemas.js";

export function Expert({profileId,machineId,date,provider,onSettings,onEvidence}:{profileId:number;machineId:number;date:string;provider:AIProviderId;onSettings():void;onEvidence(evidence:EvidenceReference):void}){
  const [localReady,setLocalReady]=useState(false),[busy,setBusy]=useState(false);
  const [settingsMessage,setSettingsMessage]=useState("Loading local AI configuration…");
  useEffect(()=>{
    if(provider!=="ollama")return;
    let live=true;
    setLocalReady(false);setSettingsMessage("Loading local AI configuration…");
    void window.oscar.getExpertSettings().then(settings=>{
      if(!live)return;
      const configured=settings.enabled&&!!settings.model;
      setLocalReady(configured);
      setSettingsMessage(configured?"Local AI configured. Model compatibility is checked by the backend when analysis starts.":"Select Local Ollama and choose a model in Settings → AI to begin.");
    }).catch(()=>{if(live)setSettingsMessage("Could not load local AI configuration. Check Settings → AI.");});
    return()=>{live=false;};
  },[provider]);
  return <div className="expert-page">
    <header className="expert-provider-summary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-lg font-semibold">OSCAR Expert</h2><p className="m-0 text-sm">AI provider: {provider==="ollama"?"Local Ollama":provider==="groq"?"Groq":"OpenAI"}</p></div>
        <button className="secondary" disabled={busy} onClick={onSettings}>Configure AI in Settings</button>
      </div>
      <p className="mb-0 mt-2 text-xs text-[var(--muted)]">{provider==="ollama"?"Local processing on the backend computer. Validated reviews and read-only tools; no cloud fallback.":provider==="groq"?"Cloud processing by Groq using selected OSCAR measurements and read-only tools; no public MCP endpoint or tunnel.":"Cloud processing by OpenAI using selected OSCAR measurements through read-only MCP."} AI interpretations can be wrong. Educational observations, not diagnosis or treatment advice.</p>
      {provider==="ollama"&&<p className="mb-0 mt-1 text-xs text-[var(--muted)]" role="status">{settingsMessage}</p>}
    </header>
    <ExpertAnalysis key={provider} profileId={profileId} machineId={machineId} date={date} provider={provider} ready={provider!=="ollama"||localReady} onBusyChange={setBusy} onEvidence={onEvidence}/>
  </div>;
}
