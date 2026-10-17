import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Settings } from "lucide-react";
import { Card } from "./ui";
import { ExpertReview } from "./ExpertReview";
import { ExpertMarkdown } from "./components/expert/ExpertMarkdown";
import { ExpertComposer, ExpertConversationActions } from "./components/expert/ExpertComposer";
import type { EvidenceReference, ReviewResult } from "../../../src/expert/schemas.js";
import { dailyIntents, trendIntents, compareIntents, type AIRequest, type AIJob, type AIProviderId } from "../../../src/ai/contracts.js";
import { lastNight, presetRange, comparisonPreset, shiftDate } from "../../../src/ai/analysis.js";

type Mode="Daily"|"Trend"|"Compare"|"Ask Anything";
const title=(value:string)=>value.split("_").map(word=>word==="ahi"?"AHI":word[0]!.toUpperCase()+word.slice(1)).join(" ");
export function ExpertAnalysis({profileId,machineId,date,provider,toolbarTarget,ready=true,settingsMessage,onSettings,onEvidence}:{profileId:number;machineId:number;date:string;provider:AIProviderId;toolbarTarget?:HTMLElement|null;ready?:boolean;settingsMessage?:string;onSettings():void;onEvidence(evidence:EvidenceReference):void}){
  const [mode,setMode]=useState<Mode>("Daily"),[selectedDate,setSelectedDate]=useState(date),[days,setDays]=useState("30");
  const [range,setRange]=useState(()=>presetRange(lastNight(),30));const [periods,setPeriods]=useState(()=>comparisonPreset(lastNight(),7));
  const [message,setMessage]=useState(""),[conversationId,setConversationId]=useState<string>(),[job,setJob]=useState<AIJob>();
  const [entries,setEntries]=useState<Array<{role:string;text:string;review?:ReviewResult}>>([]),[status,setStatus]=useState(""),[error,setError]=useState("");
  const [starting,setStarting]=useState(false);
  const [hasData,setHasData]=useState<boolean>();const active=useRef<{id:string;cursor:number}|undefined>(undefined);const alive=useRef(true);const submitting=useRef(false);
  const scope={profileId,machineId};const busy=job?.state==="running";
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(active.current)void window.oscar.cancelAI(active.current.id,{profileId,machineId}).catch(()=>{});};},[profileId,machineId]);
  useEffect(()=>{let cancelled=false;setHasData(undefined);void window.oscar.getTherapyHistory(machineId,selectedDate,selectedDate).then(data=>{if(!cancelled)setHasData(data.some(day=>day.usageHours>0));}).catch(()=>{if(!cancelled)setHasData(undefined);});return()=>{cancelled=true;};},[machineId,selectedDate]);
  function receive(next:AIJob){
    if(!alive.current)return;
    active.current={id:next.id,cursor:next.nextCursor};setJob(next);setConversationId(next.conversationId);
    for(const event of next.events){if(event.type==="text_delta")setEntries(previous=>{const result=previous.slice(),last=result.at(-1);if(last?.role==="Expert")result[result.length-1]={...last,text:last.text+event.text};else result.push({role:"Expert",text:event.text});return result;});else if(event.type==="review")setEntries(previous=>[...previous,{role:"Expert",text:"",review:event.result}]);else if(event.type==="status")setStatus(event.text);else if(event.type==="error")setError(event.text);else setStatus("Complete");}
    if(next.state!=="running")active.current=undefined;
  }
  useEffect(()=>{const current=active.current;if(!busy||!current)return;return window.oscar.watchAIJob(current.id,scope,current.cursor,receive,()=>{setError("AI connection lost; the analysis was cancelled. Check your backend connection.");void window.oscar.cancelAI(current.id,scope).catch(()=>{});active.current=undefined;setJob(undefined);});},[job?.id,busy,profileId,machineId]);
  async function start(request:AIRequest,label:string){if(submitting.current||busy||!ready)return;submitting.current=true;setStarting(true);setError("");setStatus("Starting…");try{const next=await window.oscar.startAI({...request,provider});if(!alive.current){void window.oscar.cancelAI(next.id,scope);return;}setEntries(previous=>[...previous,{role:"You",text:label}]);receive(next);}catch(cause){if(alive.current){setError(cause instanceof Error?cause.message:"Could not start Expert analysis");setStatus("");}}finally{submitting.current=false;if(alive.current)setStarting(false);}}
  function guided(intent:string){const context={...scope,...(conversationId?{conversationId}:{})};const request=mode==="Daily"?{...context,type:"analysis",dateMode:"single",date:selectedDate,intent}:mode==="Trend"?{...context,type:"analysis",dateMode:"range",...range,intent}:{...context,type:"analysis",dateMode:"compare",...periods,intent};const dates=mode==="Daily"?selectedDate:mode==="Trend"?`${range.startDate} – ${range.endDate}`:`${periods.periodA.startDate} – ${periods.periodA.endDate} vs ${periods.periodB.startDate} – ${periods.periodB.endDate}`;void start(request as AIRequest,`${title(intent)} · ${dates}`);}
  async function clear(all=false){try{await window.oscar.clearAIHistory(scope,all?undefined:conversationId);setConversationId(undefined);setEntries([]);setJob(undefined);active.current=undefined;setError("");setStatus("");}catch{setError("Could not clear AI history");}}
  const dateInput=(label:string,value:string,change:(v:string)=>void)=><label className="text-sm">{label}<input className="ml-2" type="date" value={value} onChange={e=>change(e.target.value)}/></label>;
  const criteria=<section className="expert-criteria" aria-label="AI analysis criteria" tabIndex={0}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-sm font-semibold">AI analysis criteria</h2>
        <span className="expert-provider-badge" aria-label={`Current AI provider: ${provider==="ollama"?"Local Ollama":provider==="groq"?"Groq":"OpenAI"}`}>{provider==="ollama"?"Local Ollama":provider==="groq"?"Groq":"OpenAI"}</span>
        <button className="icon-button" type="button" title="Configure AI in Settings" aria-label="Configure AI in Settings" disabled={busy||starting} onClick={onSettings}><Settings size={16}/></button>
        <ExpertConversationActions conversationActive={!!conversationId} busy={busy} starting={starting}
          onNewConversation={()=>{setConversationId(undefined);setEntries([]);setError("");setStatus("");}}
          onClearConversation={()=>void clear()} onClearHistory={()=>void clear(true)} />
      </div>
      {settingsMessage&&<p className="mb-2 mt-0 text-xs text-[var(--muted)]" role="status">{settingsMessage}</p>}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Analysis mode">{(["Daily","Trend","Compare","Ask Anything"] as Mode[]).map(value=><button className={mode===value?"":"secondary"} key={value} aria-pressed={mode===value} disabled={busy} onClick={()=>setMode(value)}>{value}</button>)}</div>
      <fieldset className="mt-3 space-y-3" disabled={busy||starting||!ready}>
      {mode==="Daily"&&<><div className="flex flex-wrap gap-3 items-center">{dateInput("Date",selectedDate,setSelectedDate)}<button className="secondary" onClick={()=>setSelectedDate(lastNight())}>Last Night</button></div><p className="text-sm text-[var(--muted)]">{hasData===false?"No included session on this date. Select another therapy date.":hasData?"Included OSCAR therapy data available.":"Checking data availability…"}</p></>}
      {mode==="Trend"&&<><label>Period<select className="ml-2" value={days} onChange={e=>{setDays(e.target.value);if(e.target.value!=="custom")setRange(presetRange(lastNight(),Number(e.target.value)));}}>{[7,14,30,90].map(n=><option key={n} value={n}>Last {n} days</option>)}<option value="custom">Custom Range</option></select></label><div className="flex flex-wrap gap-4">{dateInput("From",range.startDate,value=>{setDays("custom");setRange({...range,startDate:value});})}{dateInput("To",range.endDate,value=>{setDays("custom");setRange({...range,endDate:value});})}</div></>}
      {mode==="Compare"&&<><div className="flex flex-wrap gap-2">{[7,30].map(n=><button key={n} className="secondary" onClick={()=>setPeriods(comparisonPreset(lastNight(),n))}>Last {n} days vs Previous {n} days</button>)}<button className="secondary" onClick={()=>{const today=shiftDate(lastNight(),1),first=today.slice(0,7)+"-01",previousLast=shiftDate(first,-1);setPeriods({periodA:{startDate:previousLast.slice(0,7)+"-01",endDate:previousLast},periodB:{startDate:first,endDate:today}});}}>This month vs Last month</button></div>{(["periodA","periodB"] as const).map((key,index)=><div className="flex flex-wrap items-center gap-4" key={key}><strong>Period {index===0?"A":"B"}</strong>{dateInput("From",periods[key].startDate,value=>setPeriods({...periods,[key]:{...periods[key],startDate:value}}))}{dateInput("To",periods[key].endDate,value=>setPeriods({...periods,[key]:{...periods[key],endDate:value}}))}</div>)}</>}
      {mode!=="Ask Anything"&&<div className="flex flex-wrap gap-2">{(mode==="Daily"?dailyIntents:mode==="Trend"?trendIntents:compareIntents).map(intent=><button className="secondary" key={intent} disabled={mode==="Daily"&&hasData!==true} onClick={()=>guided(intent)}>{title(intent)}</button>)}</div>}
      {mode==="Ask Anything"&&!conversationId&&<div>{dateInput("Question range from",range.startDate,value=>setRange({...range,startDate:value}))} {dateInput("to",range.endDate,value=>setRange({...range,endDate:value}))}</div>}
      </fieldset>
    </section>;
  return <div className="expert-analysis">
    {toolbarTarget?createPortal(criteria,toolbarTarget):criteria}
    <Card className="expert-conversation p-3 sm:p-4">
      <div className="expert-conversation-scroll space-y-5" role="log" aria-label="Expert conversation" tabIndex={0}>
        {!entries.length&&<p className="text-sm text-[var(--muted)]">Choose an analysis above or ask a question below to start a conversation.</p>}
        {entries.map((entry,index)=>
        <div key={index} className={`expert-message ${entry.role==="You"?"expert-message-user":"expert-message-assistant"}`}>
          <div className="expert-message-body">
            <p className="expert-message-author">{entry.role}</p>
            {entry.review?<ExpertReview result={entry.review} onEvidence={onEvidence}/>:entry.role==="Expert"?<ExpertMarkdown text={entry.text}/>:<p className="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed">{entry.text}</p>}
          </div>
        </div>
      )}</div>
      <p role="status" className="my-4 text-sm text-[var(--muted)]">{status}</p>{error&&<p role="alert" className="my-3 text-sm text-red-400">{error}</p>}
      <ExpertComposer message={message} onMessageChange={setMessage} maxLength={provider==="ollama"?2000:4000}
        conversationActive={!!conversationId} busy={busy} starting={starting} ready={ready}
        onSend={text=>{if(submitting.current||busy||starting||!ready)return;setMessage("");void start({...scope,type:"chat",dateMode:"chat",message:text,...(conversationId?{conversationId}:{range})},text);}}
        onStop={()=>{if(active.current)void window.oscar.cancelAI(active.current.id,scope).catch(()=>setError("Could not cancel; check the backend connection"));}} />
    </Card>
  </div>;
}
