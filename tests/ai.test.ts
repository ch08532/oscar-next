import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpenAIProvider } from "../src/ai/providers/openai/provider.js";
import { AISettingsStore } from "../src/ai/configuration/settings.js";
import { TunnelManager, type TunnelChild, type TunnelDependencies } from "../src/ai/providers/openai/tunnel.js";
import { PrivateAIMcp } from "../src/ai/mcp/server.js";
import { AIService } from "../src/ai/service.js";
import { aiRequestSchema } from "../src/ai/contracts.js";
import { analysisInput, lastNight, presetRange, comparisonPreset } from "../src/ai/analysis.js";
import { minimumCloudData } from "../src/ai/tools/privacy.js";
import { OscarDatabase } from "../src/storage/database.js";
import { Machine } from "../src/core/machine.js";
import { Session } from "../src/core/session.js";
import { MachineType } from "../src/core/types.js";
import { startOscarApiServer } from "../src/api/server.js";
import type { AIMessage } from "../src/ai/providers/provider.js";
import { createRestOscarApi } from "../apps/desktop/src/rest-adapter.js";
import { spawn } from "node:child_process";

const config={apiKey:"SYNTHETIC-OPENAI-KEY",model:"test-model",tunnelId:"tunnel_synthetic"};
const settings={enabled:true,provider:"openai" as const,model:config.model,tunnelEnabled:true,tunnelId:config.tunnelId};
const wait=(ms=10)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const sse=(events:unknown[])=>events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join("");
async function fixture(run:(path:string,scope:{profileId:number;machineId:number})=>Promise<void>){const dir=await mkdtemp(join(tmpdir(),"oscar-ai-test-")),path=join(dir,"synthetic.sqlite"),db=new OscarDatabase(path);try{const profile=db.createProfile("PRIVATE-SYNTHETIC-PROFILE","UTC"),machine=new Machine(42,{type:MachineType.CPAP,brand:"Synthetic",serial:"PRIVATE-SYNTHETIC-SERIAL"}),session=new Session(1,MachineType.CPAP);session.setBounds(Date.parse("2026-10-16T22:00:00Z"),Date.parse("2026-10-17T06:00:00Z"));machine.addSession(session);db.saveMachine(machine,{profileId:profile.id});await run(path,{profileId:profile.id,machineId:42});}finally{db.close();await rm(dir,{recursive:true,force:true});}}

test("OpenAI streaming and ask explicitly disable response storage, use tunnel and read-only allowlist",async()=>{
  const calls:Array<{url:string;body:any;headers:Headers}>=[];
  const fetcher:typeof fetch=async(url,init)=>{calls.push({url:String(url),body:init?.body?JSON.parse(String(init.body)):undefined,headers:new Headers(init?.headers)});return new Response(sse([{type:"response.mcp_call.in_progress"},{type:"response.output_text.delta",delta:"Measured "},{type:"response.output_text.delta",delta:"summary"},{type:"response.completed"}]),{headers:{"content-type":"text/event-stream"}});};
  const provider=new OpenAIProvider(config,fetcher),request={messages:[{role:"user" as const,content:"Test selected dates"}],signal:new AbortController().signal};
  assert.equal(await provider.ask(request),"Measured summary");const events=[];for await(const event of provider.stream(request))events.push(event);assert.equal(events[0]?.type,"status");
  for(const call of calls){assert.equal(call.body.store,false);assert.equal(call.body.model,config.model);assert.equal(call.body.stream,true);assert.equal(call.body.previous_response_id,undefined);assert.equal(call.body.conversation,undefined);assert.equal(call.body.tools[0].tunnel_id,config.tunnelId);assert.equal(call.body.tools[0].server_url,undefined);assert.equal(call.body.tools[0].allowed_tools.read_only,true);assert.equal(call.body.tools[0].require_approval,"never");assert.equal(call.body.tools[0].allowed_tools.tool_names.length,8);assert.equal(call.headers.get("authorization"),`Bearer ${config.apiKey}`);assert.equal(JSON.stringify(call.body).includes(config.apiKey),false);}
});
test("OpenAI connection test uses configured model and errors never reflect provider bodies or credentials",async()=>{
  let url="";const provider=new OpenAIProvider(config,async(input)=>{url=String(input);return new Response("{}",{status:200});});await provider.testConnection(new AbortController().signal);assert.ok(url.endsWith("/models/test-model"));
  for(const status of [401,403,404,429,500]){const bad=new OpenAIProvider(config,async()=>new Response(config.apiKey,{status}));await assert.rejects(()=>bad.ask({messages:[],signal:new AbortController().signal}),/OpenAI/);}
  assert.throws(()=>new OpenAIProvider({...config,apiKey:""}),/Configure/);
});
test("OpenAI handles split UTF-8 streams, failure, truncation and cancellation",async()=>{
  const encoded=new TextEncoder().encode(sse([{type:"response.output_text.delta",delta:"é"},{type:"response.completed"}]));let offset=0;
  const provider=new OpenAIProvider(config,async()=>new Response(new ReadableStream({pull(controller){if(offset<encoded.length)controller.enqueue(encoded.slice(offset,++offset));else controller.close();}})));
  assert.equal(await provider.ask({messages:[],signal:new AbortController().signal}),"é");
  for(const events of [[{type:"response.output_text.delta",delta:"Partial"}],[{type:"response.failed",error:config.apiKey}],[{type:"response.incomplete"}],[{type:"response.mcp_call.failed"}]])await assert.rejects(()=>new OpenAIProvider(config,async()=>new Response(sse(events))).ask({messages:[],signal:new AbortController().signal}));
  const controller=new AbortController();let aborted=false;
  const blocking=new OpenAIProvider(config,async(_url,init)=>new Promise((_resolve,reject)=>{init?.signal?.addEventListener("abort",()=>{aborted=true;reject(Error("secret provider error"));});}));
  const pending=blocking.ask({messages:[],signal:controller.signal});controller.abort();await assert.rejects(()=>pending,/OpenAI/);assert.equal(aborted,true);
});

test("AI settings never return secrets, support replacement/removal, and never persist headless plaintext",async()=>fixture(async(path)=>{
  const store=new AISettingsStore(`${path}.ai.json`);assert.equal((await store.view()).apiKeyConfigured,false);
  let view=await store.configure({...settings,apiKey:config.apiKey,runtimeKey:"PRIVATE-RUNTIME"});assert.equal(view.apiKeyConfigured,true);assert.equal(view.secretStorage,"memory-only");
  const file=await readFile(`${path}.ai.json`,"utf8");assert.equal(file.includes(config.apiKey),false);assert.equal(file.includes("PRIVATE-RUNTIME"),false);assert.equal(JSON.stringify(view).includes(config.apiKey),false);
  assert.equal((await store.credentials()).apiKey,config.apiKey);await store.configure({...settings,apiKey:"REPLACED"});assert.equal((await store.credentials()).apiKey,"REPLACED");assert.equal((await store.credentials()).runtimeKey,"PRIVATE-RUNTIME");
  view=await store.configure({...settings,apiKey:null,runtimeKey:null});assert.equal(view.apiKeyConfigured,false);assert.equal(view.runtimeKeyConfigured,false);
  assert.equal((await new AISettingsStore(`${path}.ai.json`).credentials()).apiKey,"");await assert.rejects(()=>store.configure({...settings,store:true,apiKey:config.apiKey}),/Invalid/);
}));
test("AI OS secret codec encrypts only persisted values and handles unavailable storage",async()=>fixture(async(path)=>{
  const store=new AISettingsStore(`${path}.ai.json`,{encrypt:value=>Array.from(new TextEncoder().encode(value)).join("-"),decrypt:value=>new TextDecoder().decode(Uint8Array.from(value.split("-").map(Number)))});
  const view=await store.configure({...settings,apiKey:config.apiKey,runtimeKey:"PRIVATE-RUNTIME"});assert.equal(view.secretStorage,"os-encrypted");assert.equal((await readFile(`${path}.ai.json`,"utf8")).includes(config.apiKey),false);assert.equal((await store.credentials()).apiKey,config.apiKey);
  const locked=new AISettingsStore(`${path}.locked.json`,{encrypt(){throw Error(config.apiKey);},decrypt(){throw Error(config.apiKey);}});await assert.rejects(()=>locked.configure({...settings,apiKey:config.apiKey}),/securely/);
}));
test("Guided requests preserve exact dates, match intents to modes, and reject invalid/unbounded inputs",()=>{
  const scope={profileId:1,machineId:42};assert.equal(lastNight(new Date(2026,9,17,10)),"2026-10-16");assert.deepEqual(presetRange("2026-10-16",30),{startDate:"2026-09-17",endDate:"2026-10-16"});assert.deepEqual(comparisonPreset("2026-10-16",7),{periodA:{startDate:"2026-10-03",endDate:"2026-10-09"},periodB:{startDate:"2026-10-10",endDate:"2026-10-16"}});
  for(const raw of [{...scope,type:"analysis",dateMode:"single",intent:"ahi_analysis",date:"2026-10-16"},{...scope,type:"analysis",dateMode:"range",intent:"ahi_trend",...presetRange("2026-10-16",90)},{...scope,type:"analysis",dateMode:"compare",intent:"compare_overall",...comparisonPreset("2026-10-16",7)},{...scope,type:"chat",dateMode:"chat",message:"Why?",range:presetRange("2026-10-16",7)}]){const request=aiRequestSchema.parse(raw);assert.ok(analysisInput(request).includes("2026-10-16"));}
  for(const raw of [{...scope,type:"analysis",dateMode:"single",intent:"ahi_trend",date:"2026-10-16"},{...scope,type:"analysis",dateMode:"range",intent:"ahi_trend",startDate:"2026-01-01",endDate:"2026-10-16"},{...scope,type:"analysis",dateMode:"single",intent:"ahi_analysis",date:"2026-02-30"}])assert.equal(aiRequestSchema.safeParse(raw).success,false);
});
test("Cloud identity filter removes nested scope/identity without dropping measurements",()=>{assert.deepEqual(minimumCloudData({profileId:1,machineId:42,evidence:{id:"private",date:"2026-10-16"},data:{serial:"private",name:"private",ahi:4.3,usageHours:8,sessions:[{sessionId:1,pressure:10}]}}),{evidence:{date:"2026-10-16"},data:{ahi:4.3,usageHours:8,sessions:[{pressure:10}]}});});

class Child implements TunnelChild {handlers=new Map<string,Array<(...args:any[])=>void>>();killed:string[]=[];once(event:string,callback:(...args:any[])=>void){this.handlers.set(event,[...(this.handlers.get(event)??[]),callback]);return this;}emit(event:string){const handlers=this.handlers.get(event)??[];this.handlers.delete(event);handlers.forEach(callback=>callback());}kill(signal="SIGTERM"){this.killed.push(signal);queueMicrotask(()=>this.emit("exit"));return true;}}
function fakeTunnel(verify?:()=>Promise<string>){const children:Child[]=[],launches:Array<{file:string;args:string[];env:Record<string,string|undefined>}>=[];let healthy=true,ready=true;const deps:TunnelDependencies={verify:verify??(async()=>"verified-binary"),launch(file,args,env){const child=new Child();children.push(child);launches.push({file,args,env});return child;},probe:async url=>url.endsWith("/healthz")?healthy:ready,readHealthUrl:async()=>"http://127.0.0.1:12345"};const tunnel=new TunnelManager(deps,5,3);return {tunnel,children,launches,health:(h:boolean,r:boolean)=>{healthy=h;ready=r;}};}
const tunnelConfig={tunnelId:config.tunnelId,runtimeKey:"PRIVATE-RUNTIME",mcpUrl:"http://127.0.0.1:12346/mcp",mcpToken:"PRIVATE-MCP"};
test("Tunnel lifecycle verifies binary, launches without argv secrets, probes readiness and awaits shutdown",async()=>{
  const fake=fakeTunnel();try{assert.equal(fake.tunnel.getStatus().state,"stopped");await fake.tunnel.configure(tunnelConfig);assert.equal(fake.tunnel.getStatus().ready,false);await wait(40);assert.equal(fake.tunnel.getStatus().state,"connected");assert.equal(JSON.stringify(fake.launches[0]?.args).includes("PRIVATE"),false);assert.equal(fake.launches[0]?.env.CONTROL_PLANE_API_KEY,"PRIVATE-RUNTIME");const file=fake.launches[0]!.args[2]!;const contents=await readFile(file,"utf8");assert.equal(contents.includes("PRIVATE-RUNTIME"),false);assert.ok(contents.includes("env:CONTROL_PLANE_API_KEY"));await fake.tunnel.stop();assert.deepEqual(fake.children[0]?.killed,["SIGTERM"]);assert.equal(fake.tunnel.getStatus().process,false);}finally{await fake.tunnel.stop();}
});
test("Tunnel unexpected exits use bounded recovery, stop at limit and allow manual restart",async()=>{
  const fake=fakeTunnel();try{await fake.tunnel.configure(tunnelConfig);for(let i=0;i<4;i++){fake.children.at(-1)!.emit("exit");await wait(100);}assert.equal(fake.children.length,4);assert.equal(fake.tunnel.getStatus().state,"failed");assert.equal(fake.tunnel.getStatus().attempts,3);await fake.tunnel.restart();await wait(30);assert.equal(fake.tunnel.getStatus().ready,true);assert.equal(fake.tunnel.getStatus().attempts,0);}finally{await fake.tunnel.stop();}
});
test("Tunnel health and readiness are independent; missing runtime never spawns",async()=>{
  const fake=fakeTunnel();try{fake.health(true,false);await fake.tunnel.configure(tunnelConfig);await wait(30);assert.equal(fake.tunnel.getStatus().healthy,true);assert.equal(fake.tunnel.getStatus().ready,false);fake.health(false,false);await wait(30);assert.equal(fake.tunnel.getStatus().healthy,false);}finally{await fake.tunnel.stop();}
  const missing=fakeTunnel(async()=>{throw Error("Verified tunnel binary missing");});await missing.tunnel.configure(tunnelConfig);assert.equal(missing.children.length,0);assert.equal(missing.tunnel.getStatus().state,"failed");await missing.tunnel.stop();
});
test("Normal tunnel shutdown awaits a real owned child process exit",async()=>{
  let child:any;
  const tunnel=new TunnelManager({verify:async()=>process.execPath,launch(){child=spawn(process.execPath,["-e","setInterval(() => {}, 1000)"],{stdio:"ignore",windowsHide:true,shell:false});return child;},probe:async()=>true,readHealthUrl:async()=>"http://127.0.0.1:12345"},5);
  try{await tunnel.configure(tunnelConfig);await wait(40);assert.equal(child.exitCode,null);await tunnel.stop();assert.ok(child.exitCode!==null||child.signalCode!==null);assert.equal(tunnel.getStatus().process,false);}finally{await tunnel.stop();}
});
test("An unhealthy tunnel is terminated and recovered after its startup grace",async()=>{
  let now=1;const children:Child[]=[];
  const tunnel=new TunnelManager({verify:async()=>"verified-binary",launch(){const child=new Child();children.push(child);return child;},probe:async()=>false,readHealthUrl:async()=>"http://127.0.0.1:12345",now:()=>now},5);
  try{await tunnel.configure(tunnelConfig);now=31_001;await wait(80);assert.ok(children.length>=2);assert.deepEqual(children[0]?.killed,["SIGTERM"]);assert.ok(tunnel.getStatus().attempts>=1);}finally{await tunnel.stop();}
});
test("Tunnel startup probes use discovery-only credentials without overriding analysis authorization",async()=>fixture(async(path,scope)=>{
  const mcp=new PrivateAIMcp(path),fake=fakeTunnel();await mcp.start();
  try{await fake.tunnel.configure({...tunnelConfig,mcpUrl:mcp.url,mcpToken:mcp.token});const launch=fake.launches[0]!,configuration=JSON.parse(await readFile(launch.args[2]!,"utf8"));assert.equal(configuration.mcp.extra_headers.Authorization,undefined);assert.equal(configuration.mcp.discovery_extra_headers.Authorization,"env:OSCAR_MCP_DISCOVERY_AUTH");
    const headers={"x-oscar-tunnel":launch.env.OSCAR_MCP_AUTH!,authorization:launch.env.OSCAR_MCP_DISCOVERY_AUTH!,"content-type":"application/json",accept:"application/json, text/event-stream"};
    const initialize=await fetch(mcp.url,{method:"POST",headers,body:JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"tunnel-probe",version:"1"}}})});assert.equal(initialize.status,200);await initialize.body?.cancel();
    mcp.authorize(scope,[{startDate:"2026-10-16",endDate:"2026-10-16"}]);const denied=await fetch(mcp.url,{method:"POST",headers,body:JSON.stringify({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"oscar_get_night_summary",arguments:{date:"2026-10-16"}}})});const result=await denied.json() as any;assert.equal(result.result.isError,true);
  }finally{await fake.tunnel.stop();await mcp.close();}
}));
test("Unprovisioned and tampered tunnel binaries fail closed before execution",async()=>fixture(async(path)=>{
  const previous=process.env.OSCAR_TUNNEL_MANIFEST;
  try{delete process.env.OSCAR_TUNNEL_MANIFEST;const unprovisioned=new TunnelManager();await unprovisioned.configure(tunnelConfig);assert.equal(unprovisioned.getStatus().process,false);assert.ok(unprovisioned.getStatus().error?.includes("provisioned"));await unprovisioned.stop();
    const binary=`${path}.not-executable`;await writeFile(binary,"synthetic tampered bytes");const manifest=`${path}.manifest.json`;await writeFile(manifest,JSON.stringify({file:binary,sha256:"0".repeat(64),version:"1.2.3"}));process.env.OSCAR_TUNNEL_MANIFEST=manifest;const tampered=new TunnelManager();await tampered.configure(tunnelConfig);assert.equal(tampered.getStatus().process,false);assert.ok(tampered.getStatus().error?.includes("integrity"));await tampered.stop();
  }finally{if(previous===undefined)delete process.env.OSCAR_TUNNEL_MANIFEST;else process.env.OSCAR_TUNNEL_MANIFEST=previous;}
}));

test("Private MCP initializes, discovers only read-only tools and enforces auth, scope, dates and revocation",async()=>fixture(async(path,scope)=>{
  const mcp=new PrivateAIMcp(path);await Promise.all([mcp.start(),mcp.start()]);try{const names=await mcp.check();assert.equal(names.length,8);assert.equal(names.includes("execute_sql"),false);
    assert.equal((await fetch(mcp.url,{method:"POST",body:"{}"})).status,403);
    assert.equal((await fetch(mcp.url,{method:"POST",headers:{authorization:`Bearer ${mcp.token}`,origin:"https://untrusted.invalid"},body:"{}"})).status,403);
    let authorization=`Bearer ${mcp.token}`;
    const call=async(name:string,args:unknown)=>{const response=await fetch(mcp.url,{method:"POST",headers:{authorization,"x-oscar-tunnel":mcp.token,"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:3,method:"tools/call",params:{name,arguments:args}})});return response.status===403?{result:{isError:true},status:403}:await response.json() as any;};
    let result=await call("oscar_get_night_summary",{date:"2026-10-16"});assert.equal(result.result.isError,true);
    authorization=`Bearer ${mcp.authorize(scope,[{startDate:"2026-10-16",endDate:"2026-10-16"}])}`;result=await call("oscar_get_night_summary",{date:"2026-10-16"});assert.equal(result.result.isError,undefined);const text=result.result.content[0].text;for(const privateValue of ["PRIVATE-SYNTHETIC",path,"profileId","machineId","sessionId"])assert.equal(text.includes(privateValue),false);assert.equal(JSON.parse(text).data.usageHours,8);
    result=await call("oscar_get_night_summary",{date:"2026-10-15"});assert.equal(result.result.isError,true);mcp.revoke();result=await call("oscar_get_night_summary",{date:"2026-10-16"});assert.equal(result.status,403);
    mcp.authorize(scope,[{startDate:"2026-10-16",endDate:"2026-10-16"}]);result=await call("oscar_get_night_summary",{date:"2026-10-16"});assert.equal(result.status,403,"A stale turn cannot acquire the next turn's MCP scope");
  }finally{await mcp.close();}
}));
test("AI conversations stream incrementally, follow up locally, isolate scopes and clear history",async()=>fixture(async(path,scope)=>{
  const fake=fakeTunnel(),store=new AISettingsStore(`${path}.ai.json`);await store.configure({...settings,apiKey:config.apiKey,runtimeKey:"PRIVATE-RUNTIME"});
  const seen:AIMessage[][]=[];const service=new AIService(path,store,fake.tunnel,()=>({getCapabilities:()=>({streaming:true,tools:true,local:false}),testConnection:async()=>{},ask:async()=>"Answer",async *stream(request){seen.push(request.messages);yield {type:"text_delta",text:"First "};await wait(20);request.signal.throwIfAborted();yield {type:"text_delta",text:"answer"};}}));
  try{await service.initialize();await wait(30);const first=await service.start({...scope,type:"analysis",dateMode:"single",intent:"ahi_analysis",date:"2026-10-16"});await wait(5);let partial=service.job(first.id,scope);assert.equal(partial.state,"running");assert.ok(partial.events.some(event=>event.type==="text_delta"));const cursor=partial.nextCursor;await wait(40);const complete=service.job(first.id,scope,cursor);assert.equal(complete.state,"complete");assert.equal(complete.events.filter(e=>e.type==="text_delta").map(e=>e.type==="text_delta"?e.text:"").join(""),"answer");
    assert.throws(()=>service.job(first.id,{...scope,profileId:scope.profileId+1}),/scope/);
    const followup=await service.start({...scope,type:"chat",dateMode:"chat",message:"Why?",conversationId:first.conversationId});await wait(40);assert.equal(seen[1]?.length,3);assert.ok(seen[1]?.[0]?.content.includes("2026-10-16"));assert.equal(service.job(followup.id,scope).state,"complete");await service.clear(scope,first.conversationId);assert.throws(()=>service.job(first.id,scope),/scope/);await assert.rejects(()=>service.start({...scope,type:"chat",dateMode:"chat",message:"Why?",conversationId:first.conversationId}),/Conversation/);
    await assert.rejects(()=>service.start({...scope,type:"analysis",dateMode:"single",intent:"ahi_analysis",date:"2026-10-15"}),/No included/);
  }finally{await service.close();}
}));
test("AI cancellation aborts provider, revokes MCP and drops incomplete conversation turns",async()=>fixture(async(path,scope)=>{
  const fake=fakeTunnel(),store=new AISettingsStore(`${path}.ai.json`);await store.configure({...settings,apiKey:config.apiKey,runtimeKey:"PRIVATE-RUNTIME"});let aborted=false;
  const service=new AIService(path,store,fake.tunnel,()=>({getCapabilities:()=>({streaming:true,tools:true,local:false}),testConnection:async()=>{},ask:async()=>"",async *stream(request){yield {type:"text_delta",text:"Incomplete"};await new Promise<void>(resolve=>request.signal.addEventListener("abort",()=>{aborted=true;resolve();}));request.signal.throwIfAborted();}}));
  try{await service.initialize();await wait(30);const job=await service.start({...scope,type:"analysis",dateMode:"single",intent:"sleep_summary",date:"2026-10-16"});await wait();service.job(job.id,scope,0,true);await wait();assert.equal(aborted,true);assert.equal(service.job(job.id,scope).state,"cancelled");assert.equal(fake.tunnel.getStatus().ready,true);await service.clear(scope);}finally{await service.close();}
}));
test("AI REST settings and history obey bearer/origin restrictions and never return secrets",async()=>fixture(async(path,scope)=>{
  const server=await startOscarApiServer({databasePath:path,port:0,token:"SYNTHETIC-BEARER"});
  try{const url=`${server.baseUrl}/api/v1/ai/settings`,headers={authorization:"Bearer SYNTHETIC-BEARER","content-type":"application/json"};assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{...headers,origin:"https://untrusted.invalid"}})).status,403);
    const saved=await fetch(url,{method:"PUT",headers,body:JSON.stringify({...settings,enabled:false,apiKey:config.apiKey,runtimeKey:"PRIVATE-RUNTIME"})});assert.equal(saved.status,200);const body=await saved.text();assert.equal(body.includes(config.apiKey),false);assert.equal(body.includes("PRIVATE-RUNTIME"),false);assert.equal(JSON.parse(body).apiKeyConfigured,true);
    const clear=await fetch(`${server.baseUrl}/api/v1/ai/history`,{method:"DELETE",headers,body:JSON.stringify(scope)});assert.equal(clear.status,204);
    const noConfig=await fetch(`${server.baseUrl}/api/v1/ai/jobs`,{method:"POST",headers,body:JSON.stringify({...scope,type:"analysis",dateMode:"single",intent:"ahi_analysis",date:"2026-10-16"})});assert.equal(noConfig.status,400);
  }finally{await server.close();}
}));

test("Browser adapter receives SSE deltas and completion through authenticated API",async()=>fixture(async(path,scope)=>{
  const fake=fakeTunnel(),store=new AISettingsStore(`${path}.ai.json`);await store.configure({...settings,apiKey:config.apiKey,runtimeKey:"PRIVATE-RUNTIME"});
  const service=new AIService(path,store,fake.tunnel,()=>({getCapabilities:()=>({streaming:true,tools:true,local:false}),testConnection:async()=>{},ask:async()=>"",async *stream(request){yield {type:"text_delta",text:"First "};await wait(150);request.signal.throwIfAborted();yield {type:"text_delta",text:"second"};}}));
  const server=await startOscarApiServer({databasePath:path,port:0,token:"SYNTHETIC-BEARER",ai:service}),original=globalThis.fetch;
  globalThis.fetch=(input,init)=>original(typeof input==="string"&&input.startsWith("/")?`${server.baseUrl}${input}`:input,init);
  let unsubscribe:(()=>void)|undefined;
  try{await service.initialize();await wait(30);const adapter=createRestOscarApi("SYNTHETIC-BEARER");const check=await adapter.testAI("all");assert.equal(check.ready,true);const first=await adapter.startAI({...scope,type:"analysis",dateMode:"single",date:"2026-10-16",intent:"sleep_summary"});
    const batches:any[]=[];await new Promise<void>((resolve,reject)=>{unsubscribe=adapter.watchAIJob(first.id,scope,0,job=>{batches.push(job);if(job.state!=="running")resolve();},()=>reject(Error("SSE failed")));});
    assert.ok(batches.length>=2);assert.equal(batches.at(-1).state,"complete");assert.equal(batches.flatMap(batch=>batch.events).filter(event=>event.type==="text_delta").map(event=>event.text).join(""),"First second");assert.equal((await adapter.getAIStatus()).ready,true);
  }finally{unsubscribe?.();globalThis.fetch=original;await server.close();}
}));

test("Test Everything checks private MCP even if OpenAI is unavailable; disabled tunnel cannot restart",async()=>fixture(async(path)=>{
  const fake=fakeTunnel(),store=new AISettingsStore(`${path}.ai.json`);await store.configure({...settings,apiKey:config.apiKey,runtimeKey:"PRIVATE-RUNTIME"});
  const service=new AIService(path,store,fake.tunnel,()=>({getCapabilities:()=>({streaming:true,tools:true,local:false}),testConnection:async()=>{throw Error("OpenAI connection unavailable");},ask:async()=>"",async *stream(){}}));
  try{await service.initialize();await wait(30);const status=await service.diagnostics();assert.equal(status.openai,false);assert.equal(status.mcp,true);assert.equal(status.tools.length,8);assert.equal(status.ready,false);assert.ok(status.message.includes("OpenAI"));await service.configure({...settings,enabled:false});await assert.rejects(()=>service.restartTunnel(),/Enable/);assert.equal(fake.tunnel.getStatus().process,false);}finally{await service.close();}assert.equal((await store.credentials()).apiKey,"");
}));

test("Browser SSE disconnect cancels generation while the managed tunnel stays ready",async()=>fixture(async(path,scope)=>{
  const fake=fakeTunnel(),store=new AISettingsStore(`${path}.ai.json`);await store.configure({...settings,apiKey:config.apiKey,runtimeKey:"PRIVATE-RUNTIME"});let aborted=false;
  const service=new AIService(path,store,fake.tunnel,()=>({getCapabilities:()=>({streaming:true,tools:true,local:false}),testConnection:async()=>{},ask:async()=>"",async *stream(request){yield {type:"text_delta",text:"Incomplete"};await new Promise<void>(resolve=>request.signal.addEventListener("abort",()=>{aborted=true;resolve();}));request.signal.throwIfAborted();}}));
  const server=await startOscarApiServer({databasePath:path,port:0,token:"SYNTHETIC-BEARER",ai:service});
  try{await service.initialize();await wait(30);const job=await service.start({...scope,type:"chat",message:"What do the measurements show?",range:presetRange("2026-10-16",7)});const controller=new AbortController();const response=await fetch(`${server.baseUrl}/api/v1/ai/jobs/${job.id}/events?profileId=${scope.profileId}&machineId=${scope.machineId}`,{headers:{authorization:"Bearer SYNTHETIC-BEARER"},signal:controller.signal});assert.equal(response.status,200);const reader=response.body!.getReader();await reader.read();controller.abort();await reader.cancel().catch(()=>{});await wait(200);assert.equal(aborted,true);assert.equal(service.job(job.id,scope).state,"cancelled");assert.equal(fake.tunnel.getStatus().ready,true);}finally{await server.close();}
}));
