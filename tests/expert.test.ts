import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Machine } from "../src/core/machine.js";
import { Session } from "../src/core/session.js";
import { MachineType } from "../src/core/types.js";
import { EventListType } from "../src/core/event-list.js";
import { CpapChannel as C } from "../src/core/cpap-channels.js";
import { CpapSetting as S } from "../src/core/cpap-settings.js";
import { OscarDatabase } from "../src/storage/database.js";
import { OscarQueries, therapyDayRange } from "../src/storage/queries.js";
import { ExpertTools, toolRegistry } from "../src/expert/tools.js";
import { generateReview } from "../src/expert/orchestrator.js";
import { defaultSettings, type ExpertReview, type ExpertRequest } from "../src/expert/schemas.js";
import { localEndpoint, OllamaProvider, StructuredOutputError, type ModelProvider, type ModelMessage } from "../src/expert/ollama.js";
import { ExpertService } from "../src/expert/service.js";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createServer } from "node:http";
import { startOscarApiServer, openApiDocument } from "../src/api/server.js";
import { createRestOscarApi } from "../apps/desktop/src/rest-adapter.js";

const date="2026-10-09", start=therapyDayRange(date).startMs+3_600_000;
async function fixture(run: (path:string,scope:{ profileId:number;machineId:number },db:OscarDatabase)=>Promise<void>|void) {
  const dir=await mkdtemp(join(tmpdir(),"oscar-expert-")),path=join(dir,"synthetic.sqlite"),db=new OscarDatabase(path);
  try {
    const profile=db.createProfile("Synthetic private profile","UTC"),m=new Machine(42,{ type:MachineType.CPAP,brand:"Synthetic",serial:"SYNTHETIC-PRIVATE-SERIAL" });
    const s=new Session(1,MachineType.CPAP);s.setBounds(start,start+3_600_000);
    s.addEventList(C.Pressure,EventListType.Waveform,{ rateMs:60_000,dimension:"cmH2O" }).addWaveform(start,Int16Array.from([8,10,12,14]),240_000);
    s.addEventList(C.Leak,EventListType.Waveform,{ rateMs:60_000,dimension:"L/min" }).addWaveform(start,Int16Array.from([0,24,30,40]),240_000);
    s.addEventList(C.SpO2,EventListType.Waveform,{ rateMs:60_000,dimension:"%" }).addWaveform(start,Int16Array.from([96,97,98,99]),240_000);
    const e=s.addEventList(C.ObstructiveApnea,EventListType.Event);e.addEvent(start+60_000,10);e.addEvent(start+120_000,12);m.addSession(s);db.saveMachine(m,{ profileId:profile.id,deviceTimeZone:"UTC",timeZoneSource:"profile" });
    await run(path,{profileId:profile.id,machineId:42},db);
  }finally{db.close();await rm(dir,{recursive:true,force:true});}
}
function answer(evidence:string,reviewType:ExpertReview["reviewType"]="night"):ExpertReview { return { reviewType,summary:"Review the recorded measurements with your clinician.",positiveFindings:[],itemsToReview:[{ id:"measured",severity:"info",title:"Recorded therapy",explanation:"OSCAR provided measured evidence; causes are unknown.",evidenceIds:[evidence],confidence:"high" }],questionsForClinician:[],limitations:["Synthetic test"],evidenceUsed:[evidence] }; }
function scripted(replies:Array<ModelMessage|((signal:AbortSignal)=>Promise<ModelMessage>)>):ModelProvider { return { async chat(_request,signal){const next=replies.shift();if(!next)throw Error("Unexpected model call");return typeof next==="function"?next(signal):next;} }; }

test("Expert night summary matches OSCAR and strips unnecessary identity; caches request results",async()=>fixture((path,scope)=>{
  const tools=new ExpertTools(path,scope),q=new OscarQueries(path);try{
    const summary=tools.call("get_night_summary",{date}),daily=q.getDaily(42,date),data=summary.data as {ahi:number;usageHours:number};assert.equal(data.ahi,daily.ahi);assert.equal(data.usageHours,daily.usageHours);assert.equal(tools.call("get_night_summary",{date}),summary);
    const json=JSON.stringify(summary);for(const privateValue of ["SYNTHETIC-PRIVATE-SERIAL","Synthetic private profile",path,"raw_blob","timesMs","values2"])assert.equal(json.includes(privateValue),false);
  }finally{tools.close();q.close();}
}));
test("Expert profile isolation, strict arguments, dates and bounded ranges fail closed",async()=>fixture((path,scope)=>{
  assert.throws(()=>new ExpertTools(path,{...scope,profileId:scope.profileId+1}),/profile/);const tools=new ExpertTools(path,scope);try{
    for(const [name,args] of [["execute_sql",{}],["get_night_summary",{date:"2026-02-30"}],["get_night_summary",{date,sql:"DELETE"}],["get_statistics",{startDate:date,endDate:"2027-10-09"}],["get_events",{date,startMs:start-10_000_000,endMs:start}],["get_events",{date,eventTypes:[C.Pressure]}],["get_waveform_features",{date,startMs:start,endMs:start+10_000,channels:[C.FlowRate]}]] as const)assert.throws(()=>tools.call(name,args));
  }finally{tools.close();}
}));
test("Expert exact event range is half-open and does not serialize waveforms",async()=>fixture((path,scope)=>{
  const tools=new ExpertTools(path,scope);try{const result=tools.call("get_events",{date,startMs:start+60_000,endMs:start+120_000,eventTypes:[C.ObstructiveApnea]}).data as {events:Array<{timeMs:number;durationSeconds:number}>};assert.equal(result.events.length,1);assert.equal(result.events[0]?.timeMs,start+60_000);assert.equal(result.events[0]?.durationSeconds,10);}finally{tools.close();}
}));
test("Expert pressure/leak/windowed features reuse elapsed-weighted calculations and coverage",async()=>fixture((path,scope)=>{
  const tools=new ExpertTools(path,scope);try{
    const args={date,startMs:start+60_000,endMs:start+180_000};
    const pressure=tools.call("get_pressure_analysis",args).data as {channels:Array<{average:number;recordedSeconds:number}>};assert.equal(pressure.channels[0]?.average,11);assert.equal(pressure.channels[0]?.recordedSeconds,120);
    const leak=tools.call("get_leak_analysis",args).data as {leak:{secondsAboveThreshold:number;recordedSeconds:number}};assert.equal(leak.leak.secondsAboveThreshold,60);assert.equal(leak.leak.recordedSeconds,120);
    const featureResult=tools.call("get_waveform_features",{...args,channels:[C.Pressure,C.MaskPressureHigh,C.MaskPressure,C.IPAP,C.EPAP,C.Leak,C.RespRate,C.MinuteVent]});assert.ok(featureResult.evidence.id.length<=200);
    const features=tools.call("get_waveform_features",{...args,channels:[C.Pressure]}).data as {channels:unknown[]};assert.deepEqual(features.channels,pressure.channels);
    const ox=tools.call("get_oximetry_summary",args).data as {channels:Array<{min:number}>};assert.equal(ox.channels[0]?.min,97);
    const none=tools.call("get_oximetry_summary",{date:"2026-10-08"}).data as {channels:unknown[]};assert.deepEqual(none.channels,[]);
  }finally{tools.close();}
}));
test("Expert exclusion and split noon-to-noon boundaries are preserved",async()=>fixture((path,scope,db)=>{
  db.setSessionEnabled(42,1,false);let tools=new ExpertTools(path,scope);try{const d=tools.call("get_night_summary",{date}).data as {usageHours:number;ahi:number};assert.equal(d.usageHours,0);assert.equal(d.ahi,0);assert.deepEqual((tools.call("get_events",{date}).data as {events:unknown[]}).events,[]);}finally{tools.close();}
  const m=new Machine(43,{type:MachineType.CPAP,brand:"Synthetic"}),s=new Session(2,MachineType.CPAP),noon=therapyDayRange(date).endMs;s.setBounds(noon-3_600_000,noon+3_600_000);m.addSession(s);db.saveMachine(m,{profileId:scope.profileId});tools=new ExpertTools(path,{...scope,machineId:43});try{for(const d of [date,"2026-10-10"])assert.equal((tools.call("get_night_summary",{date:d}).data as {usageHours:number}).usageHours,1);}finally{tools.close();}
}));
test("Expert summary-only indices remain separate from missing exact records",async()=>fixture((path,scope,db)=>{
  const m=new Machine(44,{type:MachineType.CPAP,brand:"Synthetic"}),s=new Session(2,MachineType.CPAP);s.setBounds(start,start+3_600_000);s.summaryOnly=true;s.settings.set(S.SummaryAHI,6);s.settings.set(S.SummaryHI,6);m.addSession(s);db.saveMachine(m,{profileId:scope.profileId});const tools=new ExpertTools(path,{...scope,machineId:44});try{assert.equal((tools.call("get_night_summary",{date}).data as {ahi:number}).ahi,6);assert.deepEqual((tools.call("get_events",{date}).data as {events:unknown[]}).events,[]);}finally{tools.close();}
}));
test("Expert range comparison includes used-night medians and explicit empty baseline",async()=>fixture((path,scope)=>{
  const tools=new ExpertTools(path,scope);try{const r=tools.call("compare_ranges",{current:{startDate:date,endDate:date},baseline:{startDate:"2026-10-08",endDate:"2026-10-08"}}).data as {current:{usedDays:number};baseline:{usedDays:number};medianNightlyAhi:{baseline:number|null};change:{ahi:number|null}};assert.equal(r.change.ahi,null);assert.equal(r.current.usedDays,1);assert.equal(r.baseline.usedDays,0);assert.equal(r.medianNightlyAhi.baseline,null);}finally{tools.close();}
}));

test("Orchestrator accepts validated evidence, lowers interpretation certainty and handles tool calls",async()=>fixture(async(path,scope)=>{
  const tools=new ExpertTools(path,scope);try{const initial=tools.call("get_night_summary",{date}),request:ExpertRequest={...scope,date,reviewType:"night"};
    for(const calls of [0,1,2]){const replies:ModelMessage[]=[];for(let i=0;i<calls;i++)replies.push({role:"assistant",content:"hidden reasoning must not display",tool_calls:[{function:{name:"get_leak_analysis",arguments:{date}}}]});replies.push({role:"assistant",content:"done"},{role:"assistant",content:JSON.stringify(answer(initial.evidence.id))});const result=await generateReview(tools,scripted(replies),request,new AbortController().signal,()=>{});assert.equal(result.review.itemsToReview[0]?.confidence,"moderate");assert.equal(result.timings.toolCalls,calls+1);assert.ok(result.timings.toolsMs>=0);}
  }finally{tools.close();}
}));
for(const [name,args,message] of [["shell",{},/unregistered/],["get_events",{date,startMs:0},/window|valid/i],["get_night_summary",{date:"2026-10-08"},/authorized/]] as const)test(`Orchestrator rejects unsafe tool request: ${name}`,async()=>fixture(async(path,scope)=>{
  const tools=new ExpertTools(path,scope);try{await assert.rejects(()=>generateReview(tools,scripted([{role:"assistant",content:"",tool_calls:[{function:{name,arguments:args}}]}]),{...scope,date,reviewType:"night"},new AbortController().signal,()=>{}),message);}finally{tools.close();}
}));
test("Orchestrator constrains generated review type to the selected request",async()=>fixture(async(path,scope)=>{
  for (const reviewType of ["night","trend","question"] as const) {
    const tools=new ExpertTools(path,scope);
    let calls=0;
    try {
      const request:ExpertRequest={...scope,date,reviewType,...(reviewType!=="night"?{range:{startDate:date,endDate:date}}:{}),...(reviewType==="question"?{question:"What do the recorded measurements show?"}:{})};
      const provider:ModelProvider={async chat(input){
        const context=input.messages[1];if(!context)throw Error("Missing initial review context");
        const initial=JSON.parse(context.content);
        assert.equal(initial.finalSchema.properties.reviewType.const,reviewType);
        assert.equal(initial.finalSchema.properties.positiveFindings.maxItems,2);
        assert.equal(initial.finalSchema.properties.itemsToReview.maxItems,2);
        assert.equal(initial.finalSchema.properties.summary.maxLength,600);
        assert.equal(initial.finalSchema.properties.itemsToReview.items.properties.explanation.maxLength,350);
        calls++;
        if (!input.format) return {role:"assistant",content:"done"};
        const format=input.format as {properties:{reviewType:{const:string}}};
        assert.equal(format.properties.reviewType.const,reviewType);
        assert.ok(input.messages.at(-1)?.content.includes(JSON.stringify(reviewType)));
        return {role:"assistant",content:JSON.stringify(answer(initial.initial.evidence.id,reviewType))};
      }};
      const result=await generateReview(tools,provider,request,new AbortController().signal,()=>{});
      assert.equal(result.review.reviewType,reviewType);assert.equal(calls,2);
    } finally { tools.close(); }
  }
}));

test("Orchestrator rejects repeated loops, call exhaustion, malformed output and fabricated evidence",async()=>fixture(async(path,scope)=>{
  const request:ExpertRequest={...scope,date,reviewType:"night"},controller=new AbortController();
  for(const scenario of ["loop","limit","malformed","evidence","treatment","review-type"]){const tools=new ExpertTools(path,scope);try{
    const id=tools.call("get_night_summary",{date}).evidence.id,review=answer(scenario==="evidence"?"fake":id);if(scenario==="treatment")review.summary="Increase your pressure to 16 tonight.";
    if(scenario==="review-type")review.reviewType="trend";
    const call:ModelMessage={role:"assistant",content:"",tool_calls:[{function:{name:"get_leak_analysis",arguments:{date}}}]};
    const replies=scenario==="loop"?[call,call,call]:scenario==="limit"?[call]:[{role:"assistant" as const,content:"done"},{role:"assistant" as const,content:scenario==="malformed"?"not JSON":JSON.stringify(review)}];
    await assert.rejects(()=>generateReview(tools,scripted(replies),request,controller.signal,()=>{},"test",undefined,scenario==="limit"?1:12),scenario==="review-type"?/expected night, received trend; prompt v4/:undefined);
  }finally{tools.close();}}
}));
test("Orchestrator rejects oversized reports even if a model ignores compact generation constraints",async()=>fixture(async(path,scope)=>{
  for(const oversized of ["observations","explanation"]){
    const tools=new ExpertTools(path,scope);let calls=0;
    try {
      const provider:ModelProvider={async chat(input){
        calls++;if(!input.format)return {role:"assistant",content:"done"};
        const context=input.messages[1];if(!context)throw Error("Missing context");
        const review=answer(JSON.parse(context.content).initial.evidence.id),observation=review.itemsToReview[0];
        if(!observation)throw Error("Missing observation");
        if(oversized==="observations")review.itemsToReview=[observation,{...observation,id:"second"},{...observation,id:"third"}];
        else observation.explanation="x".repeat(351);
        return {role:"assistant",content:JSON.stringify(review)};
      }};
      await assert.rejects(()=>generateReview(tools,provider,{...scope,date,reviewType:"night"},new AbortController().signal,()=>{}));
      assert.equal(calls,2);
    }finally{tools.close();}
  }
}));

test("Orchestrator regenerates malformed, empty or truncated JSON once with the same scope and schema",async()=>fixture(async(path,scope)=>{
  for (const reason of ["malformed","empty","length"] as const) {
    const tools=new ExpertTools(path,scope);let calls=0;let firstFormat:unknown;
    try {
      const provider:ModelProvider={async chat(input){
        calls++;
        if (!input.format) return {role:"assistant",content:"done"};
        if(calls===2){firstFormat=input.format;if(reason!=="malformed")throw new StructuredOutputError(reason);return {role:"assistant",content:'{"summary":"unfinished'};}
        assert.equal(calls,3);assert.deepEqual(input.format,firstFormat);
        assert.ok(input.messages.at(-1)?.content.includes("concise JSON object"));
        assert.equal(input.messages.some(message=>message.content.includes("unfinished")),false);
        const context=input.messages[1];if(!context)throw Error("Missing context");
        return {role:"assistant",content:JSON.stringify(answer(JSON.parse(context.content).initial.evidence.id))};
      }};
      const result=await generateReview(tools,provider,{...scope,date,reviewType:"night"},new AbortController().signal,()=>{});
      assert.equal(result.review.reviewType,"night");assert.equal(result.timings.toolCalls,1);assert.equal(calls,3);
    }finally{tools.close();}
  }
}));

test("Orchestrator does not repeat generation when the context window is full",async()=>fixture(async(path,scope)=>{
  const tools=new ExpertTools(path,scope);let calls=0;
  try{
    const provider:ModelProvider={async chat(input){calls++;if(input.format)throw new StructuredOutputError("context",4096);return {role:"assistant",content:"done"};}};
    await assert.rejects(()=>generateReview(tools,provider,{...scope,date,reviewType:"night"},new AbortController().signal,()=>{}),/context window.*4096.*8192/i);
    assert.equal(calls,2);
  }finally{tools.close();}
}));

test("Orchestrator stops after one malformed JSON regeneration",async()=>fixture(async(path,scope)=>{
  const tools=new ExpertTools(path,scope);let calls=0;
  try {
    const provider:ModelProvider={async chat(){calls++;return {role:"assistant",content:calls===1?"done":"{"};}};
    await assert.rejects(()=>generateReview(tools,provider,{...scope,date,reviewType:"night"},new AbortController().signal,()=>{}),/malformed JSON after regeneration/);
    assert.equal(calls,3);
  }finally{tools.close();}
}));

test("Ollama reserves a larger bounded output budget for structured JSON",async()=>{
  const budgets:number[]=[];
  const server=createServer(async(req,res)=>{
    let body="";for await(const part of req)body+=part;
    budgets.push(JSON.parse(body).options.num_predict);
    res.setHeader("content-type","application/json");res.end(JSON.stringify({done_reason:"stop",message:{role:"assistant",content:'{"marker":"complete"}'}}));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const provider=new OllamaProvider({...defaultSettings,model:"synthetic:local",contextSize:8192,endpoint:`http://127.0.0.1:${server.address().port}`});
    const messages=[{role:"user" as const,content:"Synthetic JSON probe"}];
    await provider.chat({messages},AbortSignal.timeout(1000));
    await provider.chat({messages,format:{type:"object"}},AbortSignal.timeout(1000));
    assert.deepEqual(budgets,[3000,4096]);
  }finally{await new Promise<void>(resolve=>server.close(resolve));}
});

test("Ollama distinguishes a full context window from the output token limit",async()=>{
  let generated=690;
  const server=createServer((req,res)=>{res.setHeader("content-type","application/json");res.end(JSON.stringify({done_reason:"length",prompt_eval_count:3406,eval_count:generated,message:{role:"assistant",content:'{"summary":"unfinished'}}));});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{
    const provider=new OllamaProvider({...defaultSettings,model:"synthetic:local",contextSize:4096,endpoint:`http://127.0.0.1:${server.address().port}`});
    const input={messages:[{role:"user" as const,content:"Synthetic JSON probe"}],format:{type:"object"}};
    await assert.rejects(()=>provider.chat(input,AbortSignal.timeout(1000)),/context window.*4096.*8192/i);
    generated=4096;await assert.rejects(()=>provider.chat(input,AbortSignal.timeout(1000)),/output token limit/);
  }finally{await new Promise<void>(resolve=>server.close(resolve));}
});

test("Ollama rejects empty and token-limited structured responses before accepting partial output",async()=>{
  let reason="length",content='{"marker":"incomplete"';
  const server=createServer((req,res)=>{res.setHeader("content-type","application/json");res.end(JSON.stringify({done_reason:reason,message:{role:"assistant",content}}));});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const provider=new OllamaProvider({...defaultSettings,model:"synthetic:local",endpoint:`http://127.0.0.1:${server.address().port}`});
    const input={messages:[{role:"user" as const,content:"Synthetic JSON probe"}],format:{type:"object"}};
    await assert.rejects(()=>provider.chat(input,AbortSignal.timeout(1000)),/output token limit/);
    reason="stop";content=" ";await assert.rejects(()=>provider.chat(input,AbortSignal.timeout(1000)),/empty structured review/);
    content='{"marker":"complete"}';assert.equal((await provider.chat(input,AbortSignal.timeout(1000))).content,content);
  }finally{await new Promise<void>(resolve=>server.close(resolve));}
});

test("Orchestrator cancellation aborts the active provider",async()=>fixture(async(path,scope)=>{
  const tools=new ExpertTools(path,scope),controller=new AbortController();try{const provider=scripted([signal=>new Promise((_resolve,reject)=>{signal.addEventListener("abort",()=>reject(Error("cancelled")),{once:true});controller.abort();})]);await assert.rejects(()=>generateReview(tools,provider,{...scope,date,reviewType:"night"},controller.signal,()=>{}),/cancelled|abort/i);}finally{tools.close();}
}));
test("Ollama endpoints reject remote URLs, DNS aliases, redirects and cloud-backed models",async()=>{
  assert.equal(localEndpoint("http://localhost:11434"),"http://127.0.0.1:11434");for(const url of ["https://ollama.com","http://127.0.0.2:11434","http://localhost.evil","http://user:secret@127.0.0.1","http://127.0.0.1/api","http://127.0.0.1?proxy=cloud"])assert.throws(()=>localEndpoint(url));
  const provider=new OllamaProvider({...defaultSettings,model:"test:cloud"});await assert.rejects(()=>provider.assertLocalModel(new AbortController().signal),/cloud/i);
});
test("Expert is opt-in; application settings do not change therapy database",async()=>fixture(async(path,scope)=>{
  const service=new ExpertService(path);assert.equal((await service.settings()).enabled,false);await assert.rejects(()=>service.start({...scope,date,reviewType:"night"}),/Enable/);const before=await readFile(path);await service.configure({...defaultSettings,model:"synthetic-local"});assert.deepEqual(await readFile(path),before);await assert.rejects(()=>service.configure({...defaultSettings,endpoint:"http://example.com"}));
}));

test("Real MCP SDK stdio enumerates schemas/resources/prompts and matches direct read-only tools",async()=>fixture(async(path,scope,db)=>{
  const before=await readFile(path),transport=new StdioClientTransport({command:"node",args:["dist/src/expert/mcp.js","--database",path,"--profile",String(scope.profileId),"--machine",String(scope.machineId)],stderr:"pipe"}),client=new Client({name:"oscar-test",version:"1.0.0"}),tools=new ExpertTools(path,scope);
  try{await client.connect(transport);const listed=await client.listTools();assert.equal(listed.tools.length,8);assert.ok(listed.tools.every(t=>t.annotations?.readOnlyHint));
    const argsByName:Record<string,unknown>={get_night_summary:{date},get_events:{date},get_statistics:{startDate:date,endDate:date},compare_ranges:{current:{startDate:date,endDate:date},baseline:{startDate:"2026-10-08",endDate:"2026-10-08"}},get_pressure_analysis:{date},get_leak_analysis:{date},get_oximetry_summary:{date},get_waveform_features:{date,startMs:start,endMs:start+60_000,channels:[C.Pressure]}};
    for(const name of Object.keys(toolRegistry)){const args=argsByName[name] as Record<string,unknown>,result=await client.callTool({name:`oscar_${name}`,arguments:args});const block=result.content[0];assert.equal(block?.type,"text");if(block?.type==="text")assert.deepEqual(JSON.parse(block.text),tools.call(name,args));}
    const invalid=await client.callTool({name:"oscar_get_night_summary",arguments:{date:"bogus"}});assert.equal(invalid.isError,true);
    assert.equal((await client.listResources()).resources.length,1);assert.equal((await client.listPrompts()).prompts.length,1);assert.deepEqual(await readFile(path),before);
    db.setSessionEnabled(42,1,false);
    const refreshed=await client.callTool({name:"oscar_get_night_summary",arguments:{date}}),content=refreshed.content[0];assert.equal(content?.type,"text");if(content?.type==="text")assert.equal(JSON.parse(content.text).data.usageHours,0);
  }finally{tools.close();await client.close();}
}));

test("Ollama capability tests exercise synthetic chat, tools and schema without therapy context",async()=>{
  const seen:string[]=[],server=createServer(async(req,res)=>{let body="";for await(const part of req)body+=part;seen.push(body);res.setHeader("content-type","application/json");if(req.url==="/api/tags")return res.end(JSON.stringify({models:[{name:"synthetic:local",digest:"test"}]}));if(req.url==="/api/show")return res.end(JSON.stringify({model_info:{architecture:"synthetic"}}));const data=JSON.parse(body);return res.end(JSON.stringify({message:{role:"assistant",content:data.format?' {"marker":"oscar-local-probe"} ':data.tools?"":"hello",...(data.tools?{tool_calls:[{function:{name:"oscar_probe",arguments:{marker:"oscar-local-probe"}}}]}:{})}}));});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));try{const provider=new OllamaProvider({...defaultSettings,endpoint:`http://127.0.0.1:${server.address().port}`,model:"synthetic:local"});const result=await provider.compatibility(AbortSignal.timeout(3000));assert.equal(result.ready,true);assert.equal(seen.some(text=>text.includes(date)||text.includes("SYNTHETIC-PRIVATE-SERIAL")),false);}finally{await new Promise<void>(resolve=>server.close(resolve));}
});

test("Orchestrator enforces a short deadline without accepting partial output",async()=>fixture(async(path,scope)=>{
  const tools=new ExpertTools(path,scope);
  try { const provider:ModelProvider={chat:async(_request,signal)=>new Promise((_resolve,reject)=>{const timer=setTimeout(()=>reject(Error("provider timed out")),1000);signal.addEventListener("abort",()=>{clearTimeout(timer);reject(Error("deadline"));},{once:true});})};await assert.rejects(()=>generateReview(tools,provider,{...scope,date,reviewType:"night"},new AbortController().signal,()=>{},"test",undefined,12,15),/deadline/); }
  finally {tools.close();}
}));

test("Ollama accepts local license text mentioning Cloud but rejects cloud sources and missing weights",async()=>{
  let detail: Record<string,unknown> = { model_info:{architecture:"synthetic"}, modelfile:'FROM local-weights\nLICENSE """Copyright 2026 Alibaba Cloud"""' };
  const server=createServer((req,res)=>{
    res.setHeader("content-type","application/json");
    res.end(JSON.stringify(req.url==="/api/tags"?{models:[{name:"qwen3.5:4b",digest:"synthetic-digest"}]}:detail));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const provider=new OllamaProvider({...defaultSettings,endpoint:`http://127.0.0.1:${server.address().port}`,model:"qwen3.5:4b"});
    assert.equal(await provider.assertLocalModel(AbortSignal.timeout(1000)),"synthetic-digest");
    detail={...detail,modelfile:"FROM qwen3.5:cloud"};
    await assert.rejects(()=>provider.assertLocalModel(AbortSignal.timeout(1000)),/Remote/);
    detail={modelfile:"FROM local-weights",model_info:{}};
    await assert.rejects(()=>provider.assertLocalModel(AbortSignal.timeout(1000)),/local model weights/);
  } finally { await new Promise<void>(resolve=>server.close(resolve)); }
});

test("Ollama rejects remote metadata and redirect responses before any therapy request",async()=>{
  let redirect=false,chats=0;
  const server=createServer(async(req,res)=>{if(redirect){res.writeHead(302,{location:"https://example.com"});return res.end();}res.setHeader("content-type","application/json");if(req.url==="/api/tags")return res.end(JSON.stringify({models:[{name:"local:alias",digest:"fake"}]}));if(req.url==="/api/chat")chats++;res.end(JSON.stringify({remote_host:"https://example.com",model_info:{architecture:"fake"}}));});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));try{const provider=new OllamaProvider({...defaultSettings,endpoint:`http://127.0.0.1:${server.address().port}`,model:"local:alias"});await assert.rejects(()=>provider.assertLocalModel(AbortSignal.timeout(1000)),/Remote/);assert.equal(chats,0);redirect=true;await assert.rejects(()=>provider.models(AbortSignal.timeout(1000)),/unavailable/);}finally{await new Promise<void>(resolve=>server.close(resolve));}
});

test("Expert REST auth, contracts, job lifecycle, scope and cancellation use the shared services",async()=>fixture(async(path,scope)=>{
  let slow=false, malformed=false;
  const fake=createServer(async(req,res)=>{let body="";for await(const part of req)body+=part;res.setHeader("content-type","application/json");
    if(req.url==="/api/tags")return res.end(JSON.stringify({models:[{name:"synthetic:local",digest:"fixture"}]}));
    if(req.url==="/api/show")return res.end(JSON.stringify({model_info:{architecture:"synthetic"}}));
    const input=JSON.parse(body);let message:ModelMessage={role:"assistant",content:"hello"};
    if(input.tools?.[0]?.function.name==="oscar_probe")message={role:"assistant",content:"",tool_calls:[{function:{name:"oscar_probe",arguments:{marker:"oscar-local-probe"}}}]};
    else if(input.format?.properties?.marker)message={role:"assistant",content:JSON.stringify({marker:"oscar-local-probe"})};
    else if(input.format){const initial=JSON.parse(input.messages[1].content);message={role:"assistant",content:malformed?"broken":JSON.stringify(answer(initial.initial.evidence.id,initial.reviewType))};}
    else if(slow){req.on("close",()=>{});return;}
    res.end(JSON.stringify({message}));
  });
  await new Promise<void>(resolve=>fake.listen(0,"127.0.0.1",resolve));
  const server=await startOscarApiServer({databasePath:path,port:0,token:"synthetic-token"});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=(input,init)=>originalFetch(typeof input === "string" && input.startsWith("/") ? server.baseUrl+input : input,init);
  try{
    assert.ok(openApiDocument.paths["/api/v1/expert/reviews"]);assert.ok(openApiDocument.components.schemas.ExpertReview);
    assert.equal((await fetch(server.baseUrl+"/api/v1/expert/settings")).status,401);
    const headers={authorization:"Bearer synthetic-token","content-type":"application/json"};
    assert.equal((await fetch(server.baseUrl+"/api/v1/expert/check",{method:"POST",headers:{...headers,origin:"https://untrusted.example"},body:"{}"})).status,403);
    const api=createRestOscarApi("synthetic-token");
    assert.equal((await api.getExpertSettings()).enabled,false);
    await api.configureExpert({...defaultSettings,enabled:true,model:"synthetic:local",endpoint:`http://127.0.0.1:${fake.address().port}`});
    assert.equal((await api.listExpertModels()).length,1);assert.equal((await api.testExpertModel()).ready,true);
    const request:ExpertRequest={...scope,date,reviewType:"night"};
    const poll=async(id:string)=>{for(let i=0;i<80;i++){const job=await api.getExpertReview(id,scope);if(job.state!=="running")return job;await new Promise(resolve=>setTimeout(resolve,20));}throw Error("Job did not finish");};
    const job=await api.startExpertReview(request),done=await poll(job.id);assert.equal(done.state,"complete");assert.ok(done.result?.review.evidenceUsed.length);assert.ok(done.result?.timings.toolDurations.length);assert.equal(done.result?.promptVersion,4);assert.equal(done.result?.modelDigest,"fixture");assert.equal((await api.getExpertDiagnostics()).tools.length,8);
    await assert.rejects(()=>api.getExpertReview(job.id,{...scope,profileId:scope.profileId+1}),/scope/);
    malformed=true;const bad=await poll((await api.startExpertReview(request)).id);assert.equal(bad.state,"failed");assert.equal(bad.result,undefined);malformed=false;
    slow=true;const running=await api.startExpertReview(request);await new Promise(resolve=>setTimeout(resolve,50));await assert.rejects(()=>api.startExpertReview(request),/running/);await api.cancelExpertReview(running.id,scope);const cancelled=await poll(running.id);assert.equal(cancelled.state,"cancelled");assert.equal(cancelled.error,undefined);
  }finally{globalThis.fetch=originalFetch;await server.close();fake.closeAllConnections();await new Promise<void>(resolve=>fake.close(resolve));}
}));

test("Optional real Ollama compatibility requires explicit OSCAR_TEST_OLLAMA_MODEL",{skip:!process.env.OSCAR_TEST_OLLAMA_MODEL},async()=>{
  const model=process.env.OSCAR_TEST_OLLAMA_MODEL!;
  const provider=new OllamaProvider({...defaultSettings,model});assert.equal((await provider.compatibility(AbortSignal.timeout(180_000))).ready,true);
});

test("Optional real Ollama synthetic night review requires explicit OSCAR_TEST_OLLAMA_REVIEW_MODEL",{skip:!process.env.OSCAR_TEST_OLLAMA_REVIEW_MODEL},async()=>fixture(async(path,scope)=>{
  const model=process.env.OSCAR_TEST_OLLAMA_REVIEW_MODEL!;
  const liveProvider=new OllamaProvider({...defaultSettings,model,contextSize:8192}),tools=new ExpertTools(path,scope);
  let injectedTruncation=false;
  const provider:ModelProvider=process.env.OSCAR_TEST_OLLAMA_FORCE_RETRY?{async chat(input,signal){
    if(input.format&&!injectedTruncation){injectedTruncation=true;throw new StructuredOutputError("length");}
    return liveProvider.chat(input,signal);
  }}:liveProvider;
  try {
    await liveProvider.assertLocalModel(AbortSignal.timeout(10_000));
    const result=await generateReview(tools,provider,{...scope,date,reviewType:"night"},new AbortController().signal,()=>{},model);
    assert.equal(result.review.reviewType,"night");assert.equal(result.promptVersion,4);
    assert.ok(result.review.evidenceUsed.length);assert.ok(result.evidence.every(item=>tools.evidence.has(item.id)));
    if(process.env.OSCAR_TEST_OLLAMA_FORCE_RETRY)assert.equal(injectedTruncation,true);
  } finally { tools.close(); }
}));
