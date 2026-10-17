import { useEffect, useState } from "react";
import { Card } from "./ui";
import type { AIDiagnostics, AISettingsView, AISettingsUpdate } from "../../../src/ai/contracts.js";

export function AISettings({scope}:{scope?:{profileId:number;machineId:number}}){
  const [settings,setSettings]=useState<AISettingsView>();
  const [apiKey,setApiKey]=useState("");const [runtimeKey,setRuntimeKey]=useState("");
  const [removeApi,setRemoveApi]=useState(false);const [removeRuntime,setRemoveRuntime]=useState(false);
  const [diagnostics,setDiagnostics]=useState<AIDiagnostics>();const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);
  useEffect(()=>{void window.oscar.getAISettings().then(setSettings).catch(()=>setMessage("Open or create an OSCAR database to configure AI."));},[]);
  useEffect(()=>{let cancelled=false;let timer:ReturnType<typeof setTimeout>;const refresh=async()=>{try{const status=await window.oscar.getAIStatus();if(!cancelled)setDiagnostics(status);}catch{/* Setup may not yet have a database. */}if(!cancelled)timer=setTimeout(()=>void refresh(),2000);};void refresh();return()=>{cancelled=true;clearTimeout(timer);};},[]);
  async function action(run:()=>Promise<void>){setBusy(true);setMessage("");try{await run();}catch(error){setMessage(error instanceof Error?error.message:"AI settings operation failed");}finally{setBusy(false);}}
  async function test(component:"all"|"openai"|"mcp"|"tunnel"){const result=await window.oscar.testAI(component);setDiagnostics(result);setMessage(result.message);}
  async function save(){if(!settings)return;const update:AISettingsUpdate={enabled:settings.enabled,provider:"openai",model:settings.model,tunnelEnabled:settings.tunnelEnabled,tunnelId:settings.tunnelId,...(removeApi?{apiKey:null}:apiKey?{apiKey}:{}),...(removeRuntime?{runtimeKey:null}:runtimeKey?{runtimeKey}:{})};try{setSettings(await window.oscar.configureAI(update));setRemoveApi(false);setRemoveRuntime(false);setDiagnostics(undefined);setMessage("Settings saved. OSCAR manages tunnel startup automatically.");}finally{setApiKey("");setRuntimeKey("");}}
  return <Card className="p-5 sm:p-7"><h3 className="text-lg font-semibold">OpenAI settings</h3><p className="my-3 text-sm text-[var(--muted)]">Configure the OpenAI provider for Expert. Required selected OSCAR measurements are processed in the cloud. Choose Local Ollama in the provider selector above for local processing.</p>
    {settings&&<fieldset disabled={busy} className="space-y-4">
      <label className="flex gap-2"><input type="checkbox" checked={settings.enabled} onChange={e=>setSettings({...settings,enabled:e.target.checked})}/>Enable OpenAI analysis</label>
      <label className="block">Model<input className="mt-1 block" value={settings.model} onChange={e=>setSettings({...settings,model:e.target.value})} placeholder="OpenAI model ID"/></label>
      <label className="block">OpenAI API Key · {settings.apiKeyConfigured?"Configured":"Not configured"}<input className="mt-1 block w-full" type="password" autoComplete="off" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="Enter to replace; existing key is never returned"/></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={removeApi} onChange={e=>setRemoveApi(e.target.checked)}/>Remove saved OpenAI key on Save</label>
      <h4 className="pt-3 font-semibold">Secure MCP Tunnel</h4>
      <p className="text-sm text-[var(--muted)]">Create a tunnel and a separate runtime key in OpenAI Platform, then enter them here. Your OSCAR MCP listener stays on 127.0.0.1. The verified tunnel runtime must be included by your installer or administrator.</p>
      <label className="flex gap-2"><input type="checkbox" checked={settings.tunnelEnabled} onChange={e=>setSettings({...settings,tunnelEnabled:e.target.checked})}/>Enable managed tunnel</label>
      <label className="block">Tunnel ID<input className="mt-1 block w-full" value={settings.tunnelId} onChange={e=>setSettings({...settings,tunnelId:e.target.value})} placeholder="tunnel_…"/></label>
      <label className="block">Tunnel Runtime Key · {settings.runtimeKeyConfigured?"Configured":"Not configured"}<input className="mt-1 block w-full" type="password" autoComplete="off" value={runtimeKey} onChange={e=>setRuntimeKey(e.target.value)} placeholder="Separate runtime credential"/></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={removeRuntime} onChange={e=>setRemoveRuntime(e.target.checked)}/>Remove saved runtime key on Save</label>
      <p className="text-sm">Credential storage: {settings.secretStorage==="os-encrypted"?"OS-encrypted, backend only":"Backend memory only; re-enter keys after backend restart"}.</p>
      <div className="flex flex-wrap gap-2"><button onClick={()=>void action(save)}>Save AI Settings</button><button className="secondary" onClick={()=>void action(()=>test("all"))}>Test Everything</button><button className="secondary" onClick={()=>void action(async()=>{await window.oscar.restartAITunnel();setMessage("Tunnel restart requested; run diagnostics shortly.");})}>Restart Tunnel</button></div>
      <details><summary>Advanced Diagnostics</summary><div className="my-3 flex flex-wrap gap-2">{(["openai","mcp","tunnel"] as const).map(component=><button className="secondary" key={component} onClick={()=>void action(()=>test(component))}>Test {component==="mcp"?"MCP Connection":component==="openai"?"OpenAI Connection":"Tunnel"}</button>)}</div>
        {diagnostics&&<><dl className="admin-details"><div><dt>Tunnel process</dt><dd>{diagnostics.tunnel.process?"Running":"Stopped"}</dd></div><div><dt>Health / Readiness</dt><dd>{diagnostics.tunnel.healthy?"Healthy":"Unavailable"} / {diagnostics.tunnel.ready?"Ready":"Not ready"}</dd></div><div><dt>Recovery attempts</dt><dd>{diagnostics.tunnel.attempts} / 3</dd></div><div><dt>Last error</dt><dd>{diagnostics.tunnel.error??"None"}</dd></div></dl><p className="mt-2 text-sm">Read-only tools: {diagnostics.tools.join(", ")||"Not yet discovered"}</p></>}
      </details>
    </fieldset>}
    {diagnostics&&<div className="my-4 rounded-lg border border-[var(--border)] p-4" role="status"><p>OpenAI: {diagnostics.openai?"Connected":"Not verified"} · OSCAR MCP: {diagnostics.mcp?"Connected":"Not verified"} · {diagnostics.tools.length} read-only tools</p><p>Local OSCAR MCP: {diagnostics.mcpUrl??"Stopped"}</p><p>Tunnel: {diagnostics.tunnel.state} · AI Ready: {diagnostics.ready?"Yes":"No"}</p><p>{diagnostics.message}</p></div>}
    <div className="mt-5 text-sm space-y-2"><h4 className="font-semibold">Privacy</h4><p>OpenAI response storage: Disabled · Minimum-data mode: Enabled · MCP: Read only</p><p>Public MCP exposure: No · Inbound firewall ports: None required · Tunnel uses outbound OpenAI HTTPS</p><p>OpenAI training sharing: Verify in OpenAI account · Zero Data Retention: Account dependent</p><p>Conversations stay in backend memory for up to one hour and are lost on restart. Account retention policies still apply.</p>
    <button className="secondary" disabled={busy||!scope} onClick={()=>void action(async()=>{if(scope)await window.oscar.clearAIHistory(scope);setMessage("AI conversation history cleared for this profile and device.");})}>Clear AI Conversation History</button>{!scope&&<p>Select a profile/device to clear its history.</p>}</div>
    {message&&<p className="mt-4 text-sm" role="status">{message}</p>}
  </Card>;
}
