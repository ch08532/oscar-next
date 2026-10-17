import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GroqProvider } from "../src/ai/providers/groq/provider.js";
import { AISettingsStore, GroqSettingsStore } from "../src/ai/configuration/settings.js";
import { AIService } from "../src/ai/service.js";
import { ScopedCloudTools } from "../src/ai/tools/scoped-tools.js";
import type { AIEvent, AIRequest } from "../src/ai/contracts.js";
import { OscarDatabase } from "../src/storage/database.js";
import { Machine } from "../src/core/machine.js";
import { Session } from "../src/core/session.js";
import { MachineType } from "../src/core/types.js";
import { startOscarApiServer } from "../src/api/server.js";
import { createRestOscarApi } from "../apps/desktop/src/rest-adapter.js";

const key="SYNTHETIC-GROQ-PRIVATE-KEY",date="2026-10-16",scope={profileId:1,machineId:42};
const settings={enabled:true,provider:"groq" as const,model:"synthetic/model"};
const request:AIRequest={...scope,provider:"groq",type:"analysis",dateMode:"single",intent:"ahi_analysis",date};
const input=()=>({messages:[{role:"user" as const,content:"Analyze the selected date"}],signal:new AbortController().signal,analysis:{request:request as AIRequest,ranges:[{startDate:date,endDate:date}]}});
const wait=(ms=20)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const chunk=(delta:unknown,finish_reason:string|null=null)=>({choices:[{index:0,delta,finish_reason}]});
function stream(frames:unknown[],done=true){return new Response(frames.map(frame=>`data: ${JSON.stringify(frame)}\n\n`).join("")+(done?"data: [DONE]\n\n":""),{headers:{"content-type":"text/event-stream"}});}
function tool(name:string,args:unknown,id="call_1"){return stream([chunk({tool_calls:[{index:0,id,type:"function",function:{name,arguments:JSON.stringify(args)}}]}),chunk({},"tool_calls")]);}
function final(text="Measured answer"){return stream([chunk({content:text}),chunk({},"stop")]);}
async function fixture(run:(path:string)=>Promise<void>){const dir=await mkdtemp(join(tmpdir(),"oscar-groq-test-")),path=join(dir,"synthetic.sqlite"),db=new OscarDatabase(path);try{const profile=db.createProfile("PRIVATE-SYNTHETIC-PROFILE","UTC");assert.equal(profile.id,scope.profileId);const machine=new Machine(42,{type:MachineType.CPAP,brand:"Synthetic",serial:"PRIVATE-SYNTHETIC-SERIAL"}),session=new Session(1,MachineType.CPAP);session.setBounds(Date.parse(`${date}T22:00:00Z`),Date.parse("2026-10-17T06:00:00Z"));machine.addSession(session);db.saveMachine(machine,{profileId:profile.id});await run(path);}finally{db.close();await rm(dir,{recursive:true,force:true});}}

test("Groq streams final text, reconstructs fragmented tools, and sends only minimized scoped data",async()=>fixture(async path=>{
  const calls:Array<{url:string;body:any;headers:Headers}>=[],responses=[
    stream([chunk({reasoning:"HIDDEN-REASONING",tool_calls:[{index:0,id:"call_1",type:"function",function:{name:"oscar_get_pressure_",arguments:'{"date":"2026-'}}]}),chunk({tool_calls:[{index:0,function:{name:"analysis",arguments:'10-16"}'}}]}),chunk({},"tool_calls")]),
    stream([chunk({content:"Recorded "}),chunk({content:"usage is eight hours."}),chunk({},"stop")]),
  ];
  const provider=new GroqProvider({apiKey:key,model:settings.model,databasePath:path},async(url,init)=>{calls.push({url:String(url),body:JSON.parse(String(init?.body)),headers:new Headers(init?.headers)});return responses.shift()!;});
  const events:AIEvent[]=[];for await(const event of provider.stream(input()))events.push(event);
  assert.equal(events.filter(event=>event.type==="text_delta").map(event=>event.type==="text_delta"?event.text:"").join(""),"Recorded usage is eight hours.");assert.equal(JSON.stringify(events).includes("HIDDEN-REASONING"),false);assert.equal(calls.length,2);
  for(const call of calls){assert.equal(call.url,"https://api.groq.com/openai/v1/chat/completions");assert.equal(call.headers.get("authorization"),`Bearer ${key}`);assert.equal(call.body.model,settings.model);assert.equal(call.body.stream,true);assert.equal(call.body.store,undefined,"Groq Chat Completions does not support store");assert.equal(call.body.include_reasoning,false);assert.equal(call.body.parallel_tool_calls,false);assert.equal(call.body.tools.length,8);assert.ok(call.body.tools.every((tool:any)=>tool.type==="function"&&tool.function.name.startsWith("oscar_")));for(const privateValue of [key,path,"PRIVATE-SYNTHETIC","profileId","machineId","sessionId","tunnel_id","server_url","previous_response_id"])assert.equal(JSON.stringify(call.body).includes(privateValue),false);}
  const seed=JSON.parse(calls[0]!.body.messages.at(-1).content);assert.equal(seed.oscarMeasurements.data.usageHours,8);assert.deepEqual(seed.authorizedPeriods,[{startDate:date,endDate:date}]);assert.equal(calls[1]!.body.messages.at(-1).role,"tool");assert.equal(calls[1]!.body.messages.at(-1).tool_call_id,"call_1");
}));

test("Groq handles multiple sequential tool calls in one model turn",async()=>fixture(async path=>{
  let calls=0;const provider=new GroqProvider({apiKey:key,model:settings.model,databasePath:path},async(_url,init)=>{calls++;if(calls===1)return stream([chunk({tool_calls:[{index:0,id:"pressure",type:"function",function:{name:"oscar_get_pressure_analysis",arguments:JSON.stringify({date})}},{index:1,id:"leak",type:"function",function:{name:"oscar_get_leak_analysis",arguments:JSON.stringify({date})}}]}),chunk({},"tool_calls")]);const body=JSON.parse(String(init?.body));assert.equal(body.messages.filter((message:any)=>message.role==="tool").length,2);return final();});assert.equal(await provider.ask(input()),"Measured answer");assert.equal(calls,2);
}));

test("Groq rejects SQL, unknown tools, malformed arguments and dates outside the selected scope",async()=>fixture(async path=>{
  const before=await readFile(path);
  for(const [name,args]of [["execute_sql",{sql:"DELETE FROM sessions"}],["oscar_execute_sql",{}],["oscar_get_night_summary",{date:"2026-10-15"}],["oscar_get_night_summary",{date,sql:"SELECT *"}],["oscar_get_statistics",{startDate:"2026-10-01",endDate:date}]] as const){let calls=0;const provider=new GroqProvider({apiKey:key,model:settings.model,databasePath:path},async()=>{calls++;return tool(name,args);});await assert.rejects(()=>provider.ask(input()),/Groq|OSCAR/);assert.equal(calls,1,"Rejected results must never be sent to Groq");}
  assert.deepEqual(await readFile(path),before);
}));

test("Groq bounds repeated tool loops and total calls",async()=>fixture(async path=>{
  let calls=0;const repeated=new GroqProvider({apiKey:key,model:settings.model,databasePath:path},async()=>{calls++;return tool("oscar_get_night_summary",{date},`call_${calls}`);});await assert.rejects(()=>repeated.ask(input()),/tool request rejected/);assert.equal(calls,2,"Seed plus one identical retrieval reaches the two-call repetition bound");
  calls=0;const bounded=new GroqProvider({apiKey:key,model:settings.model,databasePath:path},async()=>{calls++;return tool("oscar_get_night_summary",{date:`2026-10-${String(calls).padStart(2,"0")}`},`call_${calls}`);});const rangeInput=input();rangeInput.analysis.ranges=[{startDate:"2026-10-01",endDate:date}];rangeInput.analysis.request={...scope,provider:"groq",type:"analysis",dateMode:"range",intent:"ahi_trend",startDate:"2026-10-01",endDate:date};await assert.rejects(()=>bounded.ask(rangeInput),/tool request rejected/);assert.equal(calls,12);
}));

test("Groq rejects truncated/error/oversized streams and never returns provider error bodies",async()=>fixture(async path=>{
  for(const response of [stream([chunk({content:"Partial"}),chunk({},"stop")],false),stream([chunk({content:"Partial"}),chunk({},"length")]),stream([{error:{message:key}}]),stream([chunk({tool_calls:[{index:0,id:"bad",function:{name:"oscar_get_night_summary",arguments:"not-json"}}]}),chunk({},"tool_calls")]),final("x".repeat(64_001))]){
    let error:unknown;try{await new GroqProvider({apiKey:key,model:settings.model,databasePath:path},async()=>response).ask(input());}catch(cause){error=cause;}assert.ok(error instanceof Error);assert.equal(String(error).includes(key),false);
  }
  for(const status of [400,401,403,404,429,500])await assert.rejects(()=>new GroqProvider({apiKey:key,model:settings.model,databasePath:path},async()=>new Response(key,{status})).ask(input()),/Groq/);
}));

test("Groq distinguishes request size, processing, rate and server failures without exposing response bodies",async()=>{
  for(const [status,expected]of [[413,/too large/i],[422,/process/i],[424,/dependency/i],[429,/rate|usage/i],[498,/capacity/i],[500,/server/i],[502,/upstream/i],[503,/unavailable/i],[504,/timed out/i],[418,/request failed/i]] as const){
    let calls=0;
    const provider=new GroqProvider({apiKey:key,model:settings.model,databasePath:"unused"},async()=>{calls++;return new Response(`${key} private therapy payload`,{status});});
    await assert.rejects(()=>provider.testConnection(new AbortController().signal),error=>error instanceof Error&&error.message.includes(`HTTP ${status}`)&&expected.test(error.message)&&!error.message.includes(key)&&!error.message.includes("private therapy payload"));
    assert.equal(calls,1);
  }
});

test("Groq preserves a 90-day trend scope and keeps partial failed answers out of follow-up history",async()=>fixture(async path=>{
  const period={startDate:"2026-07-19",endDate:date},store=new GroqSettingsStore(`${path}.groq.json`);
  await store.configure({...settings,apiKey:key});const bodies:any[]=[];let calls=0;
  const service=new AIService(path,new AISettingsStore(`${path}.ai.json`),undefined,undefined,undefined,store,config=>new GroqProvider(config,async(_url,init)=>{
    bodies.push(JSON.parse(String(init?.body)));calls++;
    if(calls===1)return stream([chunk({content:"INCOMPLETE-TREND"}),chunk({tool_calls:[{index:0,id:"detail",type:"function",function:{name:"oscar_get_night_summary",arguments:JSON.stringify({date})}}]}),chunk({},"tool_calls")]);
    if(calls===2)return new Response(key,{status:503});return final("Completed synthetic trend");
  }));
  try{
    const first=await service.start({...scope,provider:"groq",type:"analysis",dateMode:"range",intent:"ahi_trend",...period});await wait();
    const failed=service.job(first.id,scope);assert.equal(failed.state,"failed");assert.ok(failed.events.some(event=>event.type==="error"&&/HTTP 503/.test(event.text)));assert.equal(failed.events.some(event=>event.type==="complete"),false);
    const seed=JSON.parse(bodies[0].messages.at(-1).content);assert.deepEqual(seed.authorizedPeriods,[period]);assert.equal(seed.oscarMeasurements.data.totalDays,90);
    const next=await service.start({...scope,provider:"groq",type:"chat",dateMode:"chat",message:"Retry the selected trend",conversationId:first.conversationId});await wait();
    assert.equal(service.job(next.id,scope).state,"complete");assert.equal(JSON.stringify(bodies[2]).includes("INCOMPLETE-TREND"),false);assert.deepEqual(JSON.parse(bodies[2].messages.at(-1).content).authorizedPeriods,[period]);
  }finally{await service.close();}
}));

test("Groq streaming preserves split UTF-8/CRLF and aborts the upstream request on cancellation",async()=>fixture(async path=>{
  const bytes=new TextEncoder().encode(`data: ${JSON.stringify(chunk({content:"é"}))}\r\n\r\ndata: ${JSON.stringify(chunk({},"stop"))}\r\n\r\ndata: [DONE]\r\n\r\n`);let offset=0;
  const split=new GroqProvider({apiKey:key,model:settings.model,databasePath:path},async()=>new Response(new ReadableStream({pull(controller){if(offset<bytes.length)controller.enqueue(bytes.slice(offset,++offset));else controller.close();}})));assert.equal(await split.ask(input()),"é");
  let aborted=false;const controller=new AbortController();const blocking=new GroqProvider({apiKey:key,model:settings.model,databasePath:path},async(_url,init)=>new Response(new ReadableStream({start(stream){stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk({content:"Partial"}))}\n\n`));init?.signal?.addEventListener("abort",()=>{aborted=true;stream.error(Error("aborted"));},{once:true});}})));
  const pending=(async()=>{for await(const event of blocking.stream({...input(),signal:controller.signal}))if(event.type==="text_delta")controller.abort();})();await assert.rejects(()=>pending);assert.equal(aborted,true);
}));

test("Groq synthetic connection test validates model tools without reading or sending therapy data",async()=>{
  let sent:any;const provider=new GroqProvider({apiKey:key,model:settings.model,databasePath:"unused-private-path"},async(_url,init)=>{sent=JSON.parse(String(init?.body));return new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:"oscar_connection_check",arguments:"{}"}}]}}]}));});await provider.testConnection(new AbortController().signal);assert.equal(sent.stream,false);assert.equal(sent.model,settings.model);assert.equal(sent.tools.length,1);assert.equal(JSON.stringify(sent).includes("unused-private-path"),false);assert.equal(JSON.stringify(sent).includes(date),false);
  const unsupported=new GroqProvider({apiKey:key,model:settings.model,databasePath:"unused"},async()=>new Response(JSON.stringify({choices:[{message:{content:"no tool"}}]})));await assert.rejects(()=>unsupported.testConnection(new AbortController().signal),/compatibility/);assert.throws(()=>new GroqProvider({apiKey:"",model:settings.model,databasePath:"unused"}),/Configure/);
});

test("Groq model discovery uses the saved key without inference or a valid selected model",async()=>{
  let requests=0;
  const provider=new GroqProvider({apiKey:key,model:"unavailable-model",databasePath:"unused-private-path"},async(url,init)=>{
    requests++;assert.equal(String(url),"https://api.groq.com/openai/v1/models");assert.equal(init?.method,"GET");assert.equal(init?.body,undefined);assert.equal(new Headers(init?.headers).get("authorization"),`Bearer ${key}`);assert.equal(init?.redirect,"error");
    return new Response(JSON.stringify({data:[{id:"synthetic/model",active:true},{id:"another-model"},{id:"synthetic/model"},{id:"retired",active:false},{id:"invalid model"}]}));
  });
  const models=await provider.listModels(new AbortController().signal);
  assert.deepEqual(models,["another-model","synthetic/model"]);assert.equal(requests,1);assert.equal(JSON.stringify(models).includes(key),false);
});

test("Groq model discovery rejects malformed, oversized and credential-error responses safely",async()=>{
  for(const response of [new Response("not-json"),new Response(JSON.stringify({data:"invalid"})),new Response("x".repeat(256_001)),new Response(key,{status:401})]){
    const provider=new GroqProvider({apiKey:key,model:"synthetic",databasePath:"unused"},async()=>response);
    await assert.rejects(()=>provider.listModels(new AbortController().signal),error=>error instanceof Error&&!error.message.includes(key)&&/Groq/.test(error.message));
  }
});

test("Groq settings reuse secure storage, never return credentials, and support replacement/removal",async()=>fixture(async path=>{
  const codec={encrypt:(value:string)=>Array.from(new TextEncoder().encode(value)).join("-"),decrypt:(value:string)=>new TextDecoder().decode(Uint8Array.from(value.split("-").map(Number)))};
  const store=new GroqSettingsStore(`${path}.groq.json`,codec);assert.equal((await store.view()).enabled,false);const saved=await store.configure({...settings,apiKey:key});assert.equal(saved.apiKeyConfigured,true);assert.equal(saved.secretStorage,"os-encrypted");assert.equal(JSON.stringify(saved).includes(key),false);assert.equal((await readFile(`${path}.groq.json`,"utf8")).includes(key),false);assert.equal((await new GroqSettingsStore(`${path}.groq.json`,codec).credentials()).apiKey,key);
  await store.configure({...settings,apiKey:"REPLACED"});assert.equal((await store.credentials()).apiKey,"REPLACED");await store.configure({...settings});assert.equal((await store.credentials()).apiKey,"REPLACED");await store.configure({...settings,apiKey:null});assert.equal((await store.view()).apiKeyConfigured,false);
  const memory=new GroqSettingsStore(`${path}.memory.groq.json`);await memory.configure({...settings,apiKey:key});assert.equal((await memory.view()).secretStorage,"memory-only");assert.equal((await readFile(`${path}.memory.groq.json`,"utf8")).includes(key),false);assert.equal((await new GroqSettingsStore(`${path}.memory.groq.json`).credentials()).apiKey,"");memory.forgetCredentials();assert.equal((await memory.credentials()).apiKey,"");await assert.rejects(()=>memory.configure({...settings,apiKey:key,runtimeKey:"not-groq"}),/Invalid/);
}));

test("Shared cloud executor preserves comparison scopes, denies gap dates and strips identifiers",async()=>fixture(async path=>{
  const a={startDate:"2026-10-01",endDate:"2026-10-07"},b={startDate:"2026-10-10",endDate:date};const tools=new ScopedCloudTools(path,scope,[a,b]);const comparison=JSON.parse(tools.call("compare_ranges",{current:b,baseline:a}));assert.equal(comparison.evidence.profileId,undefined);assert.equal(comparison.evidence.id,undefined);assert.throws(()=>tools.call("get_night_summary",{date:"2026-10-08"}),/outside/);assert.throws(()=>tools.call("get_statistics",{startDate:a.startDate,endDate:b.endDate}),/outside/);assert.throws(()=>tools.call("get_waveform_features",{date,channels:[0],startMs:0,endMs:1}));
  const startMs=Date.parse(`${date}T12:00:00Z`),endMs=startMs+3_600_000;tools.call("get_pressure_analysis",{date,startMs,endMs});tools.call("get_pressure_analysis",{endMs,startMs,date});assert.throws(()=>tools.call("get_pressure_analysis",{startMs,date,endMs}),/Repeated/);
}));

test("Groq backend cancellation aborts inference and excludes partial turns from follow-up context",async()=>fixture(async path=>{
  const store=new GroqSettingsStore(`${path}.groq.json`);await store.configure({...settings,apiKey:key});let aborted=false,calls=0;const bodies:any[]=[];
  const service=new AIService(path,new AISettingsStore(`${path}.ai.json`),undefined,undefined,undefined,store,config=>new GroqProvider(config,async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));if(++calls>1)return final("Complete new answer");return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk({content:"INCOMPLETE-PARTIAL"}))}\n\n`));init?.signal?.addEventListener("abort",()=>{aborted=true;controller.error(Error("cancelled"));},{once:true});}}));}));
  try{const first=await service.start(request);await wait();service.job(first.id,scope,0,true);await wait();assert.equal(aborted,true);assert.equal(service.job(first.id,scope).state,"cancelled");const next=await service.start({...scope,provider:"groq",type:"chat",dateMode:"chat",message:"Try again",conversationId:first.conversationId});await wait();assert.equal(service.job(next.id,scope).state,"complete");assert.equal(JSON.stringify(bodies[1]).includes("INCOMPLETE-PARTIAL"),false);assert.equal(service.tunnel.getStatus().process,false);}finally{await service.close();}
}));

test("Groq uses isolated conversations without OpenAI settings, credentials or tunnel",async()=>fixture(async path=>{
  const groqStore=new GroqSettingsStore(`${path}.groq.json`);await groqStore.configure({...settings,apiKey:key});await writeFile(`${path}.ai.json`,"invalid unrelated OpenAI config");const bodies:any[]=[];let otherProviderCalls=0;
  const service=new AIService(path,new AISettingsStore(`${path}.ai.json`),undefined,()=>{otherProviderCalls++;throw Error("no fallback");},()=>{otherProviderCalls++;throw Error("no fallback");},groqStore,config=>new GroqProvider(config,async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return final("Local tools, Groq answer");}));
  try{const first=await service.start(request);await wait();assert.equal(first.provider,"groq");assert.equal(service.job(first.id,scope).state,"complete");assert.equal(service.mcp.url,"");assert.equal(service.tunnel.getStatus().process,false);
    const second=await service.start({...scope,type:"chat",dateMode:"chat",message:"Why?",conversationId:first.conversationId});await wait();assert.equal(second.provider,"groq");assert.ok(bodies[1].messages.some((message:any)=>message.role==="assistant"&&message.content==="Local tools, Groq answer"));
    for(const provider of ["openai","ollama"] as const)await assert.rejects(()=>service.start({...scope,provider,type:"chat",dateMode:"chat",message:"Why?",conversationId:first.conversationId}),/new conversation/);assert.equal(otherProviderCalls,0);await service.clear(scope);assert.throws(()=>service.job(first.id,scope),/scope/);
  }finally{await service.close();}assert.equal((await groqStore.credentials()).apiKey,"");
}));

test("Groq REST settings/check and streamed analysis obey auth, origin checks and the shared browser adapter",async()=>fixture(async path=>{
  const store=new GroqSettingsStore(`${path}.groq.json`);const service=new AIService(path,new AISettingsStore(`${path}.ai.json`),undefined,undefined,undefined,store,config=>new GroqProvider(config,async(url,init)=>{if(String(url).endsWith("/models"))return new Response(JSON.stringify({data:[{id:"synthetic/model",active:true}]}));const body=JSON.parse(String(init?.body));if(!body.stream)return new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:"oscar_connection_check",arguments:"{}"}}]}}]}));return final("Groq streamed result");}));
  const server=await startOscarApiServer({databasePath:path,port:0,token:"synthetic-bearer",ai:service}),original=globalThis.fetch;let unsubscribe:(()=>void)|undefined;
  globalThis.fetch=(url,init)=>original(typeof url==="string"&&url.startsWith("/")?`${server.baseUrl}${url}`:url,init);
  try{const endpoint=`${server.baseUrl}/api/v1/ai/groq/settings`;assert.equal((await original(endpoint)).status,401);assert.equal((await original(endpoint,{headers:{authorization:"Bearer synthetic-bearer",origin:"https://untrusted.invalid"}})).status,403);
    assert.equal((await original(`${server.baseUrl}/api/v1/ai/groq/models`)).status,401);assert.equal((await original(`${server.baseUrl}/api/v1/ai/groq/models`,{headers:{authorization:"Bearer synthetic-bearer",origin:"https://untrusted.invalid"}})).status,403);
    const adapter=createRestOscarApi("synthetic-bearer");const saved=await adapter.configureGroq({...settings,apiKey:key});assert.equal(saved.apiKeyConfigured,true);assert.equal(JSON.stringify(saved).includes(key),false);assert.equal((await adapter.getGroqSettings()).model,settings.model);assert.equal((await adapter.testGroq()).connected,true);assert.deepEqual(await adapter.listGroqModels(),["synthetic/model"]);
    const first=await adapter.startAI(request);const batches:any[]=[];await new Promise<void>((resolve,reject)=>{unsubscribe=adapter.watchAIJob(first.id,scope,0,job=>{batches.push(job);if(job.state!=="running")resolve();},()=>reject(Error("Groq SSE failed")));});assert.equal(batches.at(-1).provider,"groq");assert.equal(batches.at(-1).state,"complete");assert.ok(batches.flatMap(batch=>batch.events).some(event=>event.type==="text_delta"&&event.text==="Groq streamed result"));await adapter.clearAIHistory(scope);await assert.rejects(()=>adapter.getAIJob(first.id,scope,0),/scope/);await adapter.configureGroq({...settings,apiKey:null});assert.equal((await adapter.getGroqSettings()).apiKeyConfigured,false);
  }finally{unsubscribe?.();globalThis.fetch=original;await server.close();}
}));
