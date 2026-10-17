import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalExpertProvider, localReviewRequest } from "../src/ai/providers/ollama/provider.js";
import { AIService } from "../src/ai/service.js";
import { AISettingsStore } from "../src/ai/configuration/settings.js";
import type { AIProvider, ProviderRequest } from "../src/ai/providers/provider.js";
import type { AIRequest, AIEvent } from "../src/ai/contracts.js";
import type { ReviewJob, ReviewResult, ExpertRequest } from "../src/expert/schemas.js";
import { generateReview } from "../src/expert/orchestrator.js";
import { ExpertTools } from "../src/expert/tools.js";
import { OscarDatabase } from "../src/storage/database.js";
import { Machine } from "../src/core/machine.js";
import { Session } from "../src/core/session.js";
import { MachineType } from "../src/core/types.js";
import { startOscarApiServer } from "../src/api/server.js";

const scope={profileId:1,machineId:42},date="2026-10-16",range={startDate:date,endDate:date};
const daily:AIRequest={...scope,provider:"ollama",type:"analysis",dateMode:"single",intent:"ahi_analysis",date};
const wait=(ms=15)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
function result():ReviewResult{return {review:{reviewType:"night",summary:"Recorded measurements, with uncertainty.",positiveFindings:[],itemsToReview:[],questionsForClinician:[],limitations:["Synthetic data"],evidenceUsed:["synthetic-evidence"]},evidence:[{...scope,id:"synthetic-evidence",date,label:"Night"}],findings:[],timings:{toolsMs:0,generationMs:0,totalMs:0,toolCalls:1,toolDurations:[]},generatedAt:"2026-10-17T00:00:00Z",model:"synthetic-local",schemaVersion:1,promptVersion:4};}
async function fixture(run:(path:string)=>Promise<void>){const dir=await mkdtemp(join(tmpdir(),"oscar-local-shared-")),path=join(dir,"synthetic.sqlite"),db=new OscarDatabase(path);try{const p=db.createProfile("Synthetic","UTC");assert.equal(p.id,scope.profileId);const m=new Machine(42,{type:MachineType.CPAP,brand:"Synthetic"}),s=new Session(1,MachineType.CPAP);s.setBounds(Date.parse(`${date}T22:00:00Z`),Date.parse("2026-10-17T06:00:00Z"));m.addSession(s);db.saveMachine(m,{profileId:p.id});await run(path);}finally{db.close();await rm(dir,{recursive:true,force:true});}}

test("Shared Daily/Trend/Compare/chat map to existing local review semantics and exact ranges",()=>{
  const night=localReviewRequest(daily,[range]);assert.equal(night.reviewType,"night");assert.equal(night.date,date);assert.equal(night.range,undefined);assert.ok(night.question?.includes("ahi_analysis"));
  const trend=localReviewRequest({...scope,provider:"ollama",type:"analysis",dateMode:"range",intent:"ahi_trend",startDate:"2026-10-10",endDate:date},[{startDate:"2026-10-10",endDate:date}]);assert.equal(trend.reviewType,"trend");assert.deepEqual(trend.range,{startDate:"2026-10-10",endDate:date});
  const periodA={startDate:"2026-10-01",endDate:"2026-10-07"},periodB={startDate:"2026-10-10",endDate:date};
  const comparison=localReviewRequest({...scope,provider:"ollama",type:"analysis",dateMode:"compare",intent:"compare_leaks",periodA,periodB},[periodA,periodB]);assert.deepEqual(comparison.baseline,periodA);assert.deepEqual(comparison.range,periodB);
  const followup=localReviewRequest({...scope,type:"chat",dateMode:"chat",message:"Which nights changed?"},[periodA,periodB]);assert.equal(followup.reviewType,"question");assert.deepEqual(followup.range,periodB);assert.deepEqual(followup.baseline,periodA);
  assert.throws(()=>localReviewRequest({...scope,type:"chat",dateMode:"chat",message:"x".repeat(2001)},[range]),/2,000/);
});

test("Local provider keeps validated results/evidence and passes previous context to the existing service",async()=>{
  let received:ExpertRequest|undefined,history:unknown,forgotten=false;
  const review=result(),provider=new LocalExpertProvider("unused",{async start(raw,prior){received=raw as ExpertRequest;history=prior;return {id:"local-job",state:"running",status:"Working"};},job(){return {id:"local-job",state:"complete",status:"Complete",result:review};},async check(){return {reachable:true,modelAvailable:true,chat:true,tools:true,structured:true,ready:true,message:"Ready"};},forget(){forgotten=true;}});
  const prior=[{role:"user" as const,content:"Earlier exact dates"},{role:"assistant" as const,content:"Earlier measured review"}],events:AIEvent[]=[];
  for await(const event of provider.stream({messages:[...prior,{role:"user",content:"Current request"}],signal:new AbortController().signal,analysis:{request:daily,ranges:[range]}}))events.push(event);
  assert.equal(received?.date,date);assert.deepEqual(history,prior);assert.ok(events.some(event=>event.type==="review"&&event.result===review));assert.ok(events.some(event=>event.type==="text_delta"&&event.text.includes(review.review.summary)));assert.equal(forgotten,true);assert.equal(provider.getCapabilities().local,true);assert.equal(provider.getCapabilities().streaming,false);
});

test("Local provider cancellation cancels and forgets the original local job without emitting a review",async()=>{
  let cancelled=false,forgotten=false;const controller=new AbortController();
  const provider=new LocalExpertProvider("unused",{async start(){return {id:"local-job",state:"running",status:"Working"};},job(_id,_scope,cancel){if(cancel)cancelled=true;return {id:"local-job",state:cancelled?"cancelled":"running",status:"Working"};},async check(){throw Error("unused");},forget(){forgotten=true;}});
  const pending=(async()=>{for await(const event of provider.stream({messages:[],signal:controller.signal,analysis:{request:daily,ranges:[range]}})){assert.equal(event.type,"status");controller.abort();}})();
  await assert.rejects(()=>pending);assert.equal(cancelled,true);assert.equal(forgotten,true);
});

test("Local conversations need no OpenAI configuration/tunnel and cannot transfer history to cloud",async()=>fixture(async path=>{
  const seen:ProviderRequest[]=[];let cloudCalls=0;
  const local:AIProvider={getCapabilities:()=>({streaming:false,tools:true,local:true}),testConnection:async()=>{},ask:async()=>"Measured local answer",async *stream(input){seen.push(input);yield {type:"text_delta",text:"Measured local answer"};}};
  const service=new AIService(path,new AISettingsStore(`${path}.ai.json`),undefined,()=>{cloudCalls++;throw Error("Cloud must not run");},()=>local);
  try{
    // An unreadable cloud settings file must not break local-only requests.
    await writeFile(`${path}.ai.json`,"not cloud configuration");
    const first=await service.start(daily);await wait();assert.equal(service.job(first.id,scope).state,"complete");assert.equal(first.provider,"ollama");assert.equal(service.mcp.url,"");assert.equal(service.tunnel.getStatus().process,false);
    const next=await service.start({...scope,type:"chat",dateMode:"chat",message:"Why?",conversationId:first.conversationId});await wait();assert.equal(next.provider,"ollama");assert.equal(seen[1]?.messages.length,3);assert.deepEqual(seen[1]?.analysis?.ranges,[range]);assert.equal(seen[1]?.toolAuthorization,undefined);
    await assert.rejects(()=>service.start({...scope,provider:"openai",type:"chat",dateMode:"chat",message:"Why?",conversationId:first.conversationId}),/new conversation.*provider/);assert.equal(cloudCalls,0);
    await service.clear(scope);assert.throws(()=>service.job(first.id,scope),/scope/);
  }finally{await service.close();}
}));

test("Local failure never falls back to OpenAI",async()=>fixture(async path=>{
  let cloudCalls=0;const service=new AIService(path,new AISettingsStore(`${path}.ai.json`),undefined,()=>{cloudCalls++;throw Error("Cloud must not run");},()=>({getCapabilities:()=>({streaming:false,tools:true,local:true}),testConnection:async()=>{},ask:async()=>"",async *stream(){throw Error("Local model failed");}}));
  try{const job=await service.start(daily);await wait();const failed=service.job(job.id,scope);assert.equal(failed.state,"failed");assert.ok(failed.events.some(event=>event.type==="error"&&event.text.includes("No cloud fallback")));assert.equal(cloudCalls,0);}finally{await service.close();}
}));

test("Existing validated local orchestrator receives bounded, untrusted follow-up context",async()=>fixture(async path=>{
  const tools=new ExpertTools(path,scope);try{let calls=0;const id=tools.call("get_night_summary",{date}).evidence.id;
    const review=await generateReview(tools,{async chat(input){calls++;const context=input.messages.find(message=>message.content.includes("previousConversation"));assert.ok(context);assert.ok(context?.content.includes("Earlier question"));assert.equal(context?.content.includes("x".repeat(17000)),false);if(!input.format)return {role:"assistant",content:"Done"};return {role:"assistant",content:JSON.stringify({...result().review,evidenceUsed:[id]})};}},localReviewRequest(daily,[range]),new AbortController().signal,()=>{},"synthetic-local",undefined,12,180_000,[{role:"assistant",content:"x".repeat(17000)},{role:"user",content:"Earlier question"}]);assert.equal(calls,2);assert.equal(review.review.summary,result().review.summary);
  }finally{tools.close();}
}));

test("Authenticated shared API routes local provider requests with no cloud configuration",async()=>fixture(async path=>{
  const service=new AIService(path,new AISettingsStore(`${path}.ai.json`),undefined,undefined,()=>({getCapabilities:()=>({streaming:false,tools:true,local:true}),testConnection:async()=>{},ask:async()=>"Local",async *stream(){yield {type:"review",result:result()};yield {type:"text_delta",text:"Local validated answer"};}}));
  const server=await startOscarApiServer({databasePath:path,port:0,token:"synthetic-token",ai:service});
  try{const response=await fetch(`${server.baseUrl}/api/v1/ai/jobs`,{method:"POST",headers:{authorization:"Bearer synthetic-token","content-type":"application/json"},body:JSON.stringify(daily)});assert.equal(response.status,202);const job=await response.json() as ReviewJob;await wait();const poll=await fetch(`${server.baseUrl}/api/v1/ai/jobs/${job.id}?profileId=1&machineId=42`,{headers:{authorization:"Bearer synthetic-token"}});const body=await poll.json() as any;assert.equal(body.provider,"ollama");assert.equal(body.state,"complete");assert.ok(body.events.some((event:AIEvent)=>event.type==="review"));}finally{await server.close();}
}));
