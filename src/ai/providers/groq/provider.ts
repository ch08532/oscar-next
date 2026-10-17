import * as z from "zod/v4";
import { toolRegistry } from "../../../expert/tools.js";
import { systemInstructions } from "../../analysis.js";
import { ScopedCloudTools } from "../../tools/scoped-tools.js";
import type { AIEvent } from "../../contracts.js";
import type { AIProvider, ProviderRequest } from "../provider.js";

interface ToolCall { id:string; type:"function"; function:{name:string;arguments:string}; }
interface Message { role:"system"|"user"|"assistant"|"tool"; content:string|null; tool_calls?:ToolCall[]; tool_call_id?:string; }
export class GroqError extends Error {}

const httpErrors:Record<number,string>={
  400:"Groq rejected the model or tool configuration",
  401:"Groq rejected the API key; replace it in Settings → AI",
  403:"Groq denied access; check account and model permissions",
  404:"Groq model is unavailable for this account. Refresh models in Settings → AI, select a supported chat model, then test again",
  413:"Groq request is too large for the current limits; try a shorter trend range or start a new conversation",
  422:"Groq could not process the request or generated tool call; retry or select another tool-capable model",
  424:"Groq reported a failed service dependency; try again later",
  429:"Groq rate or usage limit reached; wait before retrying or check account limits",
  498:"Groq processing capacity is full; try again later",
  499:"Groq reported that the request was cancelled",
  500:"Groq reported an internal server error; try again later",
  502:"Groq reported an upstream gateway error; try again later",
  503:"Groq service is unavailable; try again later",
  504:"Groq's gateway timed out; retry or try a shorter trend range",
};

export class GroqProvider implements AIProvider {
  constructor(private readonly config:{apiKey:string;model:string;databasePath:string}, private readonly fetcher:typeof fetch=fetch) {
    if(!config.apiKey||!config.model)throw new GroqError("Configure a Groq API key and model in Settings → AI");
  }
  getCapabilities(){return {streaming:true,tools:true,local:false};}
  private async request(body:unknown,signal:AbortSignal,resource:"chat/completions"|"models"="chat/completions"):Promise<Response> {
    let response:Response;
    try {response=await this.fetcher(`https://api.groq.com/openai/v1/${resource}`,{method:resource==="models"?"GET":"POST",redirect:"error",signal,headers:{authorization:`Bearer ${this.config.apiKey}`,"content-type":"application/json"},...(resource==="models"?{}:{body:JSON.stringify(body)})});}
    catch {throw new GroqError("Groq connection failed or was cancelled; check outbound HTTPS");}
    if(!response.ok){
      // Preserve the safe HTTP status, never the vendor body (which may echo a
      // prompt or credentials). Size/processing failures are not service outages.
      await response.body?.cancel().catch(()=>{});
      const message=response.status===404&&resource==="models"?"Groq model discovery is unavailable; try again later":httpErrors[response.status]??"Groq request failed";
      throw new GroqError(`${message} (HTTP ${response.status})`);
    }
    return response;
  }
  async listModels(signal:AbortSignal):Promise<string[]> {
    // Discovery uses the saved key, without inference, therapy data or selected-model access.
    const response=await this.request(undefined,signal,"models");
    if(!response.body)throw new GroqError("Groq returned no model list");
    const reader=response.body.getReader(),decoder=new TextDecoder();let text="",bytes=0;
    try{while(true){signal.throwIfAborted();const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>256_000)throw new GroqError("Groq model list exceeded the response limit");text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    let value:unknown;try{value=JSON.parse(text);}catch{throw new GroqError("Groq returned an invalid model list");}
    if(!value||typeof value!=="object"||!("data"in value)||!Array.isArray(value.data)||value.data.length>1000)throw new GroqError("Groq returned an invalid model list");
    return [...new Set(value.data.filter((item:unknown):item is {id:string}=>!!item&&typeof item==="object"&&"id"in item&&typeof item.id==="string"&&/^[a-zA-Z0-9._:/-]{1,150}$/.test(item.id)&&!("active"in item&&item.active===false)).map(item=>item.id))].sort();
  }
  async testConnection(signal:AbortSignal):Promise<void> {
    // Synthetic tool probe: no database, conversation or therapy data is sent.
    const response=await this.request({model:this.config.model,messages:[{role:"user",content:"Call oscar_connection_check with no arguments."}],tools:[{type:"function",function:{name:"oscar_connection_check",description:"Synthetic connection test",parameters:{type:"object",properties:{},additionalProperties:false}}}],tool_choice:{type:"function",function:{name:"oscar_connection_check"}},include_reasoning:false,max_completion_tokens:128,stream:false},signal);
    if(!response.body)throw new GroqError("Groq connection test returned no response");
    const reader=response.body.getReader();let text="",bytes=0;const decoder=new TextDecoder();
    try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>64_000)throw new GroqError("Groq connection test exceeded the response limit");text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    try{const value=JSON.parse(text),call=value.choices?.[0]?.message?.tool_calls?.[0];if(call?.function?.name!=="oscar_connection_check"||JSON.stringify(JSON.parse(call.function.arguments))!=="{}")throw new Error();}
    catch{throw new GroqError("Groq model did not pass the function-calling compatibility test");}
  }
  async ask(request:ProviderRequest):Promise<string>{let answer="";for await(const event of this.stream(request))if(event.type==="text_delta")answer+=event.text;return answer;}
  private async *frames(response:Response,signal:AbortSignal):AsyncGenerator<unknown> {
    if(!response.body)throw new GroqError("Groq returned no response stream");
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="",bytes=0,finished=false;
    try{
      while(true){signal.throwIfAborted();const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4_000_000)throw new GroqError("Groq stream exceeded the response limit");buffer=(buffer+decoder.decode(value,{stream:true})).replace(/\r\n/g,"\n");if(buffer.length>256_000)throw new GroqError("Groq stream frame exceeded the response limit");
        let end:number;while((end=buffer.indexOf("\n\n"))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=frame.split("\n").filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trim()).join("\n");if(!data)continue;if(data==="[DONE]"){finished=true;return;}
          let parsed:unknown;try{parsed=JSON.parse(data);}catch{throw new GroqError("Groq returned an invalid response stream");}yield parsed;
        }
      }
      if(!finished)throw new GroqError("Groq stream ended before completion");
    }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  async *stream(input:ProviderRequest):AsyncGenerator<AIEvent> {
    if(!input.analysis)throw new GroqError("Groq analysis requires an authorized OSCAR scope");
    const {request,ranges}=input.analysis;
    const tools=new ScopedCloudTools(this.config.databasePath,{profileId:request.profileId,machineId:request.machineId},ranges);
    const definitions=Object.entries(toolRegistry).map(([name,tool])=>({type:"function",function:{name:`oscar_${name}`,description:tool.description,parameters:z.toJSONSchema(tool.schema)}}));
    const messages:Message[]=[{role:"system",content:systemInstructions},...input.messages];
    input.signal.throwIfAborted();yield {type:"status",text:"Retrieving selected OSCAR measurements…"};
    const current=ranges.at(-1)!;
    const seed=request.dateMode==="single"?tools.call("get_night_summary",{date:request.date}):ranges.length===2?tools.call("compare_ranges",{current,baseline:ranges[0]}):tools.call("get_statistics",current);
    messages.push({role:"user",content:JSON.stringify({authorizedPeriods:ranges,oscarMeasurements:JSON.parse(seed),guidance:"Use these authoritative measurements and retrieve only necessary additional details through the supplied tools."})});
    let totalText=0;
    for(let round=0;round<13;round++){
      input.signal.throwIfAborted();
      // Groq Chat Completions does not support `store`. No retention features,
      // built-in web/code tools, provider conversations or telemetry payloads.
      const response=await this.request({model:this.config.model,messages,tools:definitions,tool_choice:"auto",parallel_tool_calls:false,include_reasoning:false,max_completion_tokens:4096,stream:true},input.signal);
      const calls=new Map<number,ToolCall>();let content="",finish:string|null=null;
      for await(const raw of this.frames(response,input.signal)){
        const frame=raw as {error?:unknown;choices?:Array<{index?:number;delta?:{content?:unknown;tool_calls?:unknown};finish_reason?:string|null}>};
        if(!frame||frame.error||!Array.isArray(frame.choices)||frame.choices.length>1)throw new GroqError("Groq returned an invalid response");
        const choice=frame.choices[0];if(!choice)continue;
        if(choice.index!==undefined&&choice.index!==0)throw new GroqError("Groq returned an unexpected response choice");
        if(choice.finish_reason)finish=choice.finish_reason;
        const delta=choice.delta;
        if(typeof delta?.content==="string"&&delta.content){content+=delta.content;totalText+=delta.content.length;if(totalText>64_000)throw new GroqError("Groq answer exceeded the response limit");yield {type:"text_delta",text:delta.content};}
        // Only public content is forwarded; reasoning and provider metadata are ignored.
        if(delta?.tool_calls!==undefined){if(!Array.isArray(delta.tool_calls))throw new GroqError("Groq returned invalid tool calls");
          for(const part of delta.tool_calls){if(!Number.isInteger(part?.index)||part.index<0||part.index>=12||part.type&&part.type!=="function")throw new GroqError("Groq returned an invalid tool call");
            let call=calls.get(part.index);if(!call){call={id:"",type:"function",function:{name:"",arguments:""}};calls.set(part.index,call);}
            for(const value of [part.id,part.function?.name,part.function?.arguments])if(value!==undefined&&typeof value!=="string")throw new GroqError("Groq returned invalid tool fragments");
            call.id+=part.id??"";call.function.name+=part.function?.name??"";call.function.arguments+=part.function?.arguments??"";
            if(call.id.length>200||call.function.name.length>100||call.function.arguments.length>16_000)throw new GroqError("Groq tool arguments exceeded the limit");
          }
        }
      }
      if(finish==="stop"&&!calls.size){if(!content.trim())throw new GroqError("Groq returned an empty answer");return;}
      if(finish!=="tool_calls"||!calls.size)throw new GroqError(finish==="length"?"Groq answer reached its output limit; try a shorter range":"Groq response ended before a complete answer");
      const ordered=[...calls.entries()].sort(([a],[b])=>a-b).map(([,call])=>call),ids=new Set<string>();
      for(const call of ordered){if(!call.id||ids.has(call.id)||!Object.keys(toolRegistry).some(name=>call.function.name===`oscar_${name}`))throw new GroqError("Groq requested an unapproved or invalid OSCAR tool");ids.add(call.id);}
      messages.push({role:"assistant",content:content||null,tool_calls:ordered});
      for(const call of ordered){input.signal.throwIfAborted();yield {type:"status",text:"Checking read-only OSCAR data…"};let args:unknown;try{args=JSON.parse(call.function.arguments);}catch{throw new GroqError("Groq returned invalid OSCAR tool arguments");}
        let result:string;try{result=tools.call(call.function.name.slice(6),args);}catch{throw new GroqError("OSCAR tool request rejected; check selected dates, tool limits and data coverage");}
        input.signal.throwIfAborted();messages.push({role:"tool",tool_call_id:call.id,content:result});
      }
    }
    throw new GroqError("Groq analysis exceeded its tool round limit");
  }
}
