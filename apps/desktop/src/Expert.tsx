import { useEffect, useState } from "react";
import { ExpertAnalysis } from "./ExpertAnalysis";
import type { AIProviderId } from "../../../src/ai/contracts.js";
import type { EvidenceReference } from "../../../src/expert/schemas.js";

export function Expert({profileId,machineId,date,provider,toolbarTarget,onSettings,onEvidence}:{profileId:number;machineId:number;date:string;provider:AIProviderId;toolbarTarget?:HTMLElement|null;onSettings():void;onEvidence(evidence:EvidenceReference):void}){
  const [localReady,setLocalReady]=useState(false);
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
    <ExpertAnalysis key={provider} profileId={profileId} machineId={machineId} date={date} provider={provider} toolbarTarget={toolbarTarget} ready={provider!=="ollama"||localReady} settingsMessage={provider==="ollama"?settingsMessage:undefined} onSettings={onSettings} onEvidence={onEvidence}/>
  </div>;
}
