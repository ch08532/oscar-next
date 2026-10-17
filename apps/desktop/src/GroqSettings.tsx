import { useEffect, useRef, useState } from "react";
import { Card } from "./ui";
import type { GroqSettingsView, GroqSettingsUpdate } from "../../../src/ai/contracts.js";

export function GroqSettings({disabled=false}:{disabled?:boolean}){
  const [settings,setSettings]=useState<GroqSettingsView>(),[apiKey,setApiKey]=useState("");
  const [removeKey,setRemoveKey]=useState(false),[message,setMessage]=useState(""),[failed,setFailed]=useState(false);
  const [models,setModels]=useState<string[]>(),[operation,setOperation]=useState<"save"|"models"|"test">();
  const running=useRef(false),busy=operation!==undefined;
  useEffect(()=>{let live=true;void window.oscar.getGroqSettings().then(value=>{if(live)setSettings(value);}).catch(()=>{if(live)setMessage("Open or create an OSCAR database to configure Groq.");});return()=>{live=false;};},[]);
  async function action(kind:"save"|"models"|"test"){
    if(!settings||disabled||running.current)return;
    running.current=true;setOperation(kind);setFailed(false);setMessage("Saving Groq settings…");
    let saved=false;
    try{
      const update:GroqSettingsUpdate={enabled:settings.enabled,provider:"groq",model:settings.model,...(removeKey?{apiKey:null}:apiKey?{apiKey}:{})};
      const next=await window.oscar.configureGroq(update);
      saved=true;setSettings(next);setRemoveKey(false);setApiKey("");
      if(kind==="save"){setMessage(next.apiKeyConfigured?"Groq settings saved. API key is configured; the password field is cleared after saving.":"Groq settings saved. No API key is configured.");return;}
      if(!next.apiKeyConfigured)throw new Error("Enter a Groq API key before loading models or testing the connection");
      if(kind==="models"){
        setMessage("Loading models from Groq…");
        const available=await window.oscar.listGroqModels();setModels(available);
        setMessage(available.length?"Models loaded. Select a chat model with function calling, then test the connection. Model listing alone does not verify access or tool compatibility.":"Groq returned no active models. Check your account permissions.");
      }else{
        setMessage("Testing Groq connection and model function calling…");
        const result=await window.oscar.testGroq();setFailed(!result.connected);setMessage(result.connected?result.message:`Settings saved. ${result.message}`);
      }
    }catch(error){setFailed(true);setMessage(`${saved?"Settings saved. ":""}${error instanceof Error?error.message:"Groq settings operation failed"}`);}
    finally{running.current=false;setOperation(undefined);}
  }
  return <Card className="p-5 sm:p-7"><h3 className="text-lg font-semibold">Groq settings</h3>
    <p className="my-3 text-sm text-[var(--muted)]">Groq processes selected OSCAR measurements in the cloud. OSCAR validates and executes the read-only tools on the backend; your MCP server stays private.</p>
    {settings&&<fieldset disabled={busy||disabled} className="space-y-4">
      <label className="flex gap-2"><input type="checkbox" checked={settings.enabled} onChange={event=>setSettings({...settings,enabled:event.target.checked})}/>Enable Groq analysis</label>
      <label className="block">Model{models?.length?<select className="mt-1 block w-full" value={settings.model} onChange={event=>setSettings({...settings,model:event.target.value})}>
        {!models.includes(settings.model)&&<option value={settings.model}>{settings.model} (not in returned model list)</option>}
        {models.map(model=><option key={model} value={model}>{model}</option>)}
      </select>:<input className="mt-1 block w-full" value={settings.model} onChange={event=>setSettings({...settings,model:event.target.value})} placeholder="Groq model ID with tool support"/>}</label>
      <label className="block">Groq API Key · {settings.apiKeyConfigured?"Configured":"Not configured"}<input className="mt-1 block w-full" type="password" autoComplete="off" value={apiKey} onChange={event=>setApiKey(event.target.value)} placeholder="Enter to replace; existing key is never returned"/></label>
      {settings.apiKeyConfigured&&<p className="text-xs text-[var(--muted)]">The key is saved on the backend. This field stays empty after a successful save; enter a new key only to replace it.</p>}
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={removeKey} onChange={event=>setRemoveKey(event.target.checked)}/>Remove saved Groq key on Save</label>
      <p className="text-sm">Credential storage: {settings.secretStorage==="os-encrypted"?"OS-encrypted, backend only":"Backend memory only; re-enter the key after backend restart"}.</p>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={()=>void action("save")}>{operation==="save"?"Saving…":"Save Groq Settings"}</button><button type="button" className="secondary" onClick={()=>void action("models")}>{operation==="models"?"Loading models…":"Refresh models"}</button><button type="button" className="secondary" onClick={()=>void action("test")}>{operation==="test"?"Testing…":"Test Groq Connection"}</button></div>
      <p className="text-xs text-[var(--muted)]">Refresh models and Test save your current key and settings first. Refresh retrieves Groq's model list without inference. Test sends a small synthetic function-calling request; no therapy data is sent.</p>
    </fieldset>}
    <div className="mt-5 space-y-2 text-sm"><h4 className="font-semibold">Privacy</h4><p>Minimum-data mode: Enabled · OSCAR tools: Read only · Public MCP exposure: No</p><p>No tunnel or inbound firewall port is required. Conversations stay in backend memory and can be cleared in Expert.</p><p>Groq retention and Zero Data Retention: Verify in Groq Data Controls. OSCAR does not verify account settings or enable voluntary training/data sharing.</p></div>
    {message&&<p className="mt-4 text-sm" role={failed?"alert":"status"} aria-live="polite">{message}</p>}
  </Card>;
}
