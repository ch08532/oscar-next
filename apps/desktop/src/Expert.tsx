import { useEffect, useState } from "react";
import { Card, PageIntro } from "./ui";
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
      setSettingsMessage(configured?"Local AI configured. Model compatibility is checked by the backend when analysis starts.":"Enable local reviews and choose a model in Settings → AI to begin.");
    }).catch(()=>{if(live)setSettingsMessage("Could not load local AI configuration. Check Settings → AI.");});
    return()=>{live=false;};
  },[provider]);
  return <div className="expert-page space-y-5">
    <PageIntro title="OSCAR Expert" description="Guided analysis and questions grounded in your OSCAR measurements. AI interpretations can be wrong; verify measurements in OSCAR. Educational observations, not a diagnosis or treatment advice."/>
    <Card className="p-5 sm:p-7"><p className="font-semibold">AI provider: {provider==="ollama"?"Local Ollama":provider==="groq"?"Groq":"OpenAI"}</p>
      <p className="mt-3 text-sm text-[var(--muted)]">{provider==="ollama"?"Local processing on the OSCAR backend computer. Reviews appear after evidence and structured output are validated. No cloud fallback.":provider==="groq"?"Cloud processing. Necessary OSCAR measurements are sent to Groq. Read-only tools run on the backend without a public MCP endpoint or tunnel; answers stream as they are generated.":"Cloud processing. Required measurements from your selected dates are sent to OpenAI through read-only MCP. Answers stream as they are generated."}</p>
      <p className="mt-2 text-xs text-[var(--muted)]">Changing providers starts a separate conversation; history is never transferred between providers.</p>
      <button className="secondary mt-4" disabled={busy} onClick={onSettings}>Configure AI in Settings</button>
    </Card>
    {provider==="ollama"&&<p className="text-sm text-[var(--muted)]" role="status">{settingsMessage}</p>}
    <ExpertAnalysis key={provider} profileId={profileId} machineId={machineId} date={date} provider={provider} ready={provider!=="ollama"||localReady} onBusyChange={setBusy} onEvidence={onEvidence}/>
  </div>;
}
