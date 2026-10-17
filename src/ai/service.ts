import { randomUUID } from "node:crypto";
import { AISettingsStore, GroqSettingsStore, type SecretCodec } from "./configuration/settings.js";
import { PrivateAIMcp } from "./mcp/server.js";
import { TunnelManager } from "./providers/openai/tunnel.js";
import { OpenAIProvider } from "./providers/openai/provider.js";
import { LocalExpertProvider } from "./providers/ollama/provider.js";
import { GroqProvider, GroqError } from "./providers/groq/provider.js";
import { aiRequestSchema, type AIDiagnostics, type AIEvent, type AIJob, type AIRequest, type AIProviderId, type Range, type Scope } from "./contracts.js";
import { scopeSchema } from "../expert/schemas.js";
import { ExpertTools } from "../expert/tools.js";
import { analysisInput, requestRanges } from "./analysis.js";
import type { AIProvider, AIMessage } from "./providers/provider.js";

interface Conversation {scope:Scope;provider:AIProviderId;messages:AIMessage[];ranges:Range[];updated:number;}
interface JobRecord {id:string;conversationId:string;provider:AIProviderId;scope:Scope;state:AIJob["state"];events:AIEvent[];controller:AbortController;finished?:number;done?:Promise<void>;}
const services=new Map<string,AIService>();
let codec:SecretCodec|undefined;
export function setAISecretCodec(value:SecretCodec):void {codec=value;}
export function aiService(path:string):AIService{let value=services.get(path);if(!value||value.closed){value=new AIService(path,new AISettingsStore(`${path}.ai.json`,codec));services.set(path,value);}return value;}
export async function closeAIServices():Promise<void>{await Promise.all([...services.values()].map(service=>service.close()));services.clear();}
export class AIService {
  readonly mcp:PrivateAIMcp;
  readonly #conversations=new Map<string,Conversation>();
  readonly #jobs=new Map<string,JobRecord>();
  #busy=false;
  #initializing:Promise<void>|undefined;
  #openai=false;
  #tools:string[]=[];
  #closing=false;
  get closed():boolean{return this.#closing;}
  constructor(readonly databasePath:string,readonly settings:AISettingsStore,readonly tunnel=new TunnelManager(),private readonly providerFactory?:(config:{apiKey:string;model:string;tunnelId:string})=>AIProvider,private readonly localProviderFactory?:()=>AIProvider,readonly groqSettings=new GroqSettingsStore(`${databasePath}.groq.json`,codec),private readonly groqProviderFactory?:(config:{apiKey:string;model:string;databasePath:string})=>AIProvider){this.mcp=new PrivateAIMcp(databasePath);}
  async configureGroq(raw:unknown){if(this.#busy||this.#closing)throw new Error("Wait for the current AI operation or cancel it first");this.#busy=true;try{return await this.groqSettings.configure(raw);}finally{this.#busy=false;}}
  private async groqProvider():Promise<AIProvider>{const settings=await this.groqSettings.view(),keys=await this.groqSettings.credentials(),config={apiKey:keys.apiKey,model:settings.model,databasePath:this.databasePath};return this.groqProviderFactory?this.groqProviderFactory(config):new GroqProvider(config);}
  async listGroqModels():Promise<string[]>{
    if(this.#busy||this.#closing)throw new Error("Wait for the current AI operation");this.#busy=true;
    try{const provider=await this.groqProvider();if(!provider.listModels)throw new GroqError("Groq model discovery is unavailable; restart the backend");return await provider.listModels(AbortSignal.timeout(15_000));}
    catch(error){throw new Error(error instanceof GroqError?error.message:"Could not load Groq models; check the saved API key and outbound HTTPS");}
    finally{this.#busy=false;}
  }
  async checkGroq():Promise<import("./contracts.js").GroqConnectionCheck>{
    if(this.#busy||this.#closing)throw new Error("Wait for the current AI operation");this.#busy=true;
    try{await (await this.groqProvider()).testConnection(AbortSignal.timeout(15_000));return {connected:true,message:"Groq connection and model function calling passed. No therapy data was sent."};}
    catch(error){return {connected:false,message:error instanceof GroqError?error.message:"Groq connection check failed; verify the key, model and outbound HTTPS"};}
    finally{this.#busy=false;}
  }
  async initialize():Promise<void>{if(this.#closing)return;if(this.#initializing)return this.#initializing;this.#initializing=this.setup();try{await this.#initializing;}finally{this.#initializing=undefined;}}
  private async setup():Promise<void>{const settings=await this.settings.view();if(!settings.enabled||!settings.tunnelEnabled)return;await this.mcp.start();this.#tools=await this.mcp.check();const keys=await this.settings.credentials();await this.tunnel.configure({tunnelId:settings.tunnelId,runtimeKey:keys.runtimeKey,mcpUrl:this.mcp.url,mcpToken:this.mcp.token});}
  async configure(raw:unknown){if(this.#busy||this.#closing)throw new Error("Wait for the current AI operation or cancel it first");this.#busy=true;try{await this.#initializing?.catch(()=>{});const settings=await this.settings.configure(raw);this.#openai=false;await this.tunnel.stop();this.mcp.revoke();if(!settings.enabled)await this.mcp.close();else if(!this.#closing)await this.initialize();return settings;}finally{this.#busy=false;}}
  private async provider():Promise<AIProvider>{const settings=await this.settings.view(),keys=await this.settings.credentials();const config={apiKey:keys.apiKey,model:settings.model,tunnelId:settings.tunnelId};return this.providerFactory?this.providerFactory(config):new OpenAIProvider(config);}
  async diagnostics(test:"all"|"openai"|"mcp"|"tunnel"="all"):Promise<AIDiagnostics>{
    if(this.#busy||this.#closing)throw new Error("Wait for the current AI operation");this.#busy=true;
    const errors:string[]=[];
    try{const settings=await this.settings.view();if(!settings.enabled)throw new Error("Enable OSCAR AI in Settings first");
      if(test==="all"||test==="openai"){this.#openai=false;try{await (await this.provider()).testConnection(AbortSignal.timeout(15_000));this.#openai=true;}catch(error){errors.push(error instanceof Error?error.message:"OpenAI check failed");}}
      this.#tools=[];try{await this.mcp.start();this.#tools=await this.mcp.check();}catch{errors.push("Local OSCAR MCP initialization or read-only tool discovery failed");}
      if(settings.tunnelEnabled&&!this.tunnel.getStatus().process&&this.tunnel.getStatus().state==="stopped")await this.initialize();
      if(!this.tunnel.getStatus().ready)errors.push(this.tunnel.getStatus().error??"Tunnel starting or not ready; check again shortly");
    }catch(error){errors.push(error instanceof Error?error.message:"AI connection check failed");}finally{this.#busy=false;}
    return {...this.status(),message:errors.join(". ")||"Checks complete"};
  }
  status():AIDiagnostics{const tunnel=this.tunnel.getStatus(),mcp=!!this.mcp.url&&this.#tools.length>0;return {openai:this.#openai,mcp,mcpUrl:this.mcp.url||null,tools:this.#tools.slice(),tunnel,ready:this.#openai&&mcp&&tunnel.process&&tunnel.healthy&&tunnel.ready,message:tunnel.error??(tunnel.ready?"Tunnel connected":"Tunnel is not ready")};}
  async restartTunnel(){if(this.#busy||this.#closing)throw new Error("Wait for the current AI operation");this.#busy=true;try{const settings=await this.settings.view();if(!settings.enabled||!settings.tunnelEnabled)throw new Error("Enable OSCAR AI and Secure MCP Tunnel first");await this.tunnel.restart();if(this.tunnel.getStatus().state==="stopped")await this.initialize();return this.tunnel.getStatus();}finally{this.#busy=false;}}
  private prune(){const now=Date.now();for(const[id,c]of this.#conversations)if(now-c.updated>3_600_000)this.#conversations.delete(id);for(const[id,j]of this.#jobs)if(j.finished&&now-j.finished>300_000)this.#jobs.delete(id);}
  async start(raw:unknown):Promise<AIJob>{
    const normalized=raw&&typeof raw==="object"&&"type"in raw&&raw.type==="chat"&&!("dateMode"in raw)?{...raw,dateMode:"chat"}:raw;
    const parsed=aiRequestSchema.safeParse(normalized);if(!parsed.success)throw new Error("Invalid AI request; use valid exact dates and ranges of at most 90 days");const request=parsed.data;
    if(this.#busy||this.#closing)throw new Error("An AI operation is already running or shutting down; cancel it or wait");this.#busy=true;
    try{
      this.prune();
      const tools=new ExpertTools(this.databasePath,{profileId:request.profileId,machineId:request.machineId});
      try{if(request.dateMode==="single"&&tools.night(request.date).usageHours<=0)throw new Error("No included OSCAR therapy data for the selected date");}finally{tools.close();}
      const scope={profileId:request.profileId,machineId:request.machineId};
      let conversation=request.conversationId?this.#conversations.get(request.conversationId):undefined;
      if(request.conversationId&&(!conversation||!this.matches(conversation.scope,scope)))throw new Error("Conversation not found in the selected profile/device");
      const providerId=request.provider??conversation?.provider??"openai";
      if(conversation&&conversation.provider!==providerId)throw new Error("Start a new conversation when changing AI provider; history is kept separate");
      if(providerId==="ollama"&&request.type==="chat"&&request.message.length>2000)throw new Error("Local Expert questions support at most 2,000 characters");
      let ranges=requestRanges(request);if(!ranges.length)ranges=conversation?.ranges??[];if(!ranges.length)throw new Error("Choose an exact date range for this question");
      let provider:AIProvider;
      if(providerId==="openai"){
        const settings=await this.settings.view();if(!settings.enabled||!settings.tunnelEnabled)throw new Error("Enable OpenAI and Secure MCP Tunnel in Settings first");
        if(!this.tunnel.getStatus().ready||!this.tunnel.getStatus().healthy||!this.tunnel.getStatus().process)throw new Error("Secure MCP Tunnel is not ready; run Test Everything in Settings");
        provider=await this.provider();
      }else if(providerId==="groq"){
        if(!(await this.groqSettings.view()).enabled)throw new Error("Enable Groq analysis in Settings → AI first");
        provider=await this.groqProvider();
      }else provider=this.localProviderFactory?this.localProviderFactory():new LocalExpertProvider(this.databasePath);
      const id=request.conversationId??randomUUID();if(!conversation){if(this.#conversations.size>=20)throw new Error("Conversation limit reached; clear AI history");conversation={scope,provider:providerId,messages:[],ranges,updated:Date.now()};this.#conversations.set(id,conversation);}
      if(conversation.messages.length>=40||conversation.messages.reduce((sum,m)=>sum+m.content.length,0)>64_000)throw new Error("Conversation context limit reached; start a new conversation");
      if(this.#jobs.size>=40)throw new Error("AI job limit reached; clear history or wait five minutes");
      const job:JobRecord={id:randomUUID(),conversationId:id,provider:providerId,scope,state:"running",events:[{type:"status",text:"Reviewing the selected OSCAR dates…"}],controller:new AbortController()};this.#jobs.set(job.id,job);
      const toolAuthorization=providerId==="openai"?this.mcp.authorize(scope,ranges):undefined;const input=analysisInput(request);conversation.ranges=ranges;conversation.updated=Date.now();
      job.done=this.run(job,conversation,provider,{role:"user",content:input},request,ranges,toolAuthorization);return this.snapshot(job,0);
    }catch(error){this.#busy=false;throw error;}
  }
  private async run(job:JobRecord,conversation:Conversation,provider:AIProvider,user:AIMessage,request:AIRequest,ranges:Range[],toolAuthorization?:string):Promise<void>{
    let answer="";const signal=AbortSignal.any([job.controller.signal,AbortSignal.timeout(180_000)]);
    try{for await(const event of provider.stream({messages:[...conversation.messages,user],signal,...(toolAuthorization?{toolAuthorization}:{}),analysis:{request,ranges}})){signal.throwIfAborted();if(job.events.length>=16_000)throw new Error("AI stream event limit reached");if(event.type==="text_delta"){answer+=event.text;if(answer.length>64_000)throw new Error("AI answer too long");}this.append(job,event);}
      signal.throwIfAborted();if(!answer)throw new Error("AI returned an empty answer");conversation.messages.push(user,{role:"assistant",content:answer});conversation.updated=Date.now();job.state="complete";if(job.provider==="openai")this.#openai=true;this.append(job,{type:"complete",conversationId:job.conversationId});
    }catch(error){job.state=job.controller.signal.aborted?"cancelled":"failed";if(job.state==="failed"&&job.provider==="openai")this.#openai=false;
      const localError=error instanceof Error&&error.message.length<=600&&!error.message.startsWith("[")?error.message:"Local Expert review failed; check local settings, model compatibility and context size";
      this.append(job,{type:"error",text:job.state==="cancelled"?"Analysis cancelled. Partial text is incomplete.":signal.aborted?"AI analysis timed out; try a shorter range. Partial text is incomplete.":job.provider==="ollama"?`${localError}. No cloud fallback was used.`:job.provider==="groq"?`${error instanceof GroqError?error.message:"Groq analysis failed; check the API key, model and tool permissions"}. Partial text is incomplete.`:"AI analysis failed; check OpenAI, tunnel and OSCAR MCP in Settings. Partial text is incomplete."});}
    finally{job.finished=Date.now();if(job.provider==="openai")this.mcp.revoke();this.#busy=false;}
  }
  private append(job:JobRecord,event:AIEvent){job.events.push(event);}
  private matches(a:Scope,b:Scope){return a.profileId===b.profileId&&a.machineId===b.machineId;}
  private snapshot(job:JobRecord,cursor:number):AIJob{return {id:job.id,conversationId:job.conversationId,provider:job.provider,state:job.state,events:job.events.slice(cursor).map(event=>({...event})),nextCursor:job.events.length};}
  job(id:string,rawScope:unknown,cursor=0,cancel=false):AIJob{this.prune();const scope=scopeSchema.parse(rawScope),job=this.#jobs.get(id);if(!job||!this.matches(scope,job.scope))throw new Error("AI job not found in selected scope");if(!Number.isInteger(cursor)||cursor<0||cursor>job.events.length)throw new Error("Invalid AI event cursor");if(cancel&&job.state==="running")job.controller.abort();return this.snapshot(job,cursor);}
  async clear(rawScope:unknown,id?:string):Promise<void>{const scope=scopeSchema.parse(rawScope);for(const job of this.#jobs.values())if(this.matches(scope,job.scope)&&(!id||job.conversationId===id)){job.controller.abort();await job.done;this.#jobs.delete(job.id);}for(const[cid,c]of this.#conversations)if(this.matches(scope,c.scope)&&(!id||cid===id))this.#conversations.delete(cid);}
  async close():Promise<void>{this.#closing=true;for(const job of this.#jobs.values())job.controller.abort();await Promise.all([...this.#jobs.values()].map(job=>job.done));await this.#initializing?.catch(()=>{});await this.tunnel.stop();await this.mcp.close();this.#conversations.clear();this.#jobs.clear();this.settings.forgetCredentials();this.groqSettings.forgetCredentials();}
}
