import { useEffect, useRef, useState } from "react";
import { Card } from "./ui";
import type { Compatibility, ExpertSettings } from "../../../src/expert/schemas.js";
import { activateProvider } from "./components/settings/activate-provider";

export function LocalAISettings({deployment,disabled=false}:{deployment:"desktop"|"browser";disabled?:boolean}){
  const [settings,setSettings]=useState<ExpertSettings>();
  const [models,setModels]=useState<Array<{name:string;digest:string}>>([]);
  const [compatibility,setCompatibility]=useState<Compatibility>();
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [diagnostics,setDiagnostics]=useState<Awaited<ReturnType<typeof window.oscar.getExpertDiagnostics>>>();
  const live=useRef(true);
  useEffect(()=>{live.current=true;void activateProvider("ollama",window.oscar).then(value=>{if(live.current)setSettings(value);}).catch(error=>{if(live.current)setError(error instanceof Error?error.message:"Could not enable Local Ollama");});return()=>{live.current=false;};},[]);
  function change(next:ExpertSettings){setSettings(next);setCompatibility(undefined);}
  async function configure(action:"save"|"models"|"test"){
    if(!settings||busy||disabled)return;setBusy(true);setError("");setCompatibility(undefined);
    try{await window.oscar.configureExpert({...settings,enabled:true});if(action==="models"){const next=await window.oscar.listExpertModels();if(live.current)setModels(next);}if(action==="test"){const next=await window.oscar.testExpertModel();if(live.current)setCompatibility(next);}}
    catch(cause){if(live.current)setError(cause instanceof Error?cause.message:"Local AI operation failed");}
    finally{if(live.current)setBusy(false);}
  }
  return <Card className="p-5 sm:p-7"><h3 className="text-lg font-semibold">Local Ollama settings</h3>
    <p className="my-3 text-sm text-[var(--muted)]">{deployment==="browser"?"Ollama runs on the headless server’s computer.":"Ollama runs on this computer."} Use downloaded models with Ollama cloud features disabled. Nothing is downloaded automatically.</p>
    <fieldset disabled={busy||disabled}>
      {settings&&<div className="space-y-4">
        <label className="block">Ollama URL<input className="mt-1 block w-full" value={settings.endpoint} onChange={event=>change({...settings,endpoint:event.target.value})}/></label>
        <label className="block">Installed local model<select className="mt-1 block w-full" value={settings.model} onChange={event=>change({...settings,model:event.target.value})}><option value="">Choose a model</option>{settings.model&&!models.some(model=>model.name===settings.model)&&<option value={settings.model}>{settings.model}</option>}{models.map(model=><option key={model.name}>{model.name}</option>)}</select></label>
        <label className="block">Context size<select className="mt-1 block w-full" value={settings.contextSize??"auto"} onChange={event=>change({...settings,contextSize:event.target.value==="auto"?null:Number(event.target.value)})}><option value="auto">Model default</option>{[2048,4096,8192,16384,32768].map(value=><option key={value}>{value}</option>)}</select></label>
      </div>}
      <div className="mt-4 flex flex-wrap gap-2"><button disabled={!settings} onClick={()=>void configure("save")}>Save settings</button><button className="secondary" disabled={!settings} onClick={()=>void configure("models")}>Refresh models</button><button className="secondary" disabled={!settings?.model} onClick={()=>void configure("test")}>Test compatibility</button></div>
    </fieldset>
    {busy&&<p className="mt-3 text-sm" role="status">Checking local AI…</p>}
    {compatibility&&<div className="mt-4" role="status"><p>{compatibility.message}</p><ul className="mt-2 text-sm text-[var(--muted)]">{([["Ollama reachable",compatibility.reachable],["Local model available",compatibility.modelAvailable],["Chat",compatibility.chat],["Tool calling",compatibility.tools],["Structured JSON",compatibility.structured]] as const).map(([label,passed])=><li key={label}>{passed?"✓":"—"} {label}</li>)}</ul></div>}
    {error&&<p role="alert" className="mt-3 text-sm">{error}</p>}
    <details className="mt-4"><summary>Local Expert diagnostics / MCP</summary><button className="secondary my-3" disabled={busy||disabled} onClick={()=>void window.oscar.getExpertDiagnostics().then(setDiagnostics).catch(()=>setError("Local diagnostics unavailable"))}>Refresh diagnostics</button>{diagnostics&&<><p className="text-sm">{diagnostics.mcp}. External MCP hosts control whether their model is local or remote.</p><p className="mt-3 text-sm">Registered tools: {diagnostics.tools.join(", ")}</p>{diagnostics.lastTimings&&<ul className="mt-3 text-sm">{diagnostics.lastTimings.toolDurations.map((item,index)=><li key={index}>{item.tool}: {item.durationMs.toFixed(1)} ms</li>)}</ul>}</>}</details>
  </Card>;
}
