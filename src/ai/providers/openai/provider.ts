import { systemInstructions } from "../../analysis.js";
import { toolRegistry } from "../../../expert/tools.js";
import type { AIProvider, ProviderRequest } from "../provider.js";
import type { AIEvent } from "../../contracts.js";

export class OpenAIProvider implements AIProvider {
  constructor(private readonly config: {apiKey:string;model:string;tunnelId:string}, private readonly fetcher: typeof fetch = fetch) {
    if (!config.apiKey || !config.model || !config.tunnelId) throw new Error("Configure OpenAI API key, model and tunnel ID in Settings");
  }
  getCapabilities() { return {streaming:true,tools:true,local:false}; }
  private async request(path:string, init:RequestInit): Promise<Response> {
    let response:Response;
    try { response=await this.fetcher(`https://api.openai.com/v1/${path}`,{...init,redirect:"error",headers:{authorization:`Bearer ${this.config.apiKey}`,"content-type":"application/json"}}); }
    catch { throw new Error("OpenAI connection failed or was cancelled; check outbound HTTPS and try again"); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(response.status===401 || response.status===403 ? "OpenAI credential or permission rejected" : response.status===404 ? "OpenAI model is unavailable; check the configured model" : response.status===429 ? "OpenAI rate or usage limit reached" : "OpenAI request failed; check model and service availability"); }
    return response;
  }
  async testConnection(signal:AbortSignal):Promise<void> { const response=await this.request(`models/${encodeURIComponent(this.config.model)}`,{method:"GET",signal}); await response.body?.cancel(); }
  async ask(request:ProviderRequest):Promise<string> { let result="";for await(const event of this.stream(request))if(event.type==="text_delta")result+=event.text;return result; }
  async *stream(request:ProviderRequest):AsyncGenerator<AIEvent> {
    const response=await this.request("responses",{method:"POST",signal:request.signal,body:JSON.stringify({
      model:this.config.model,store:false,stream:true,instructions:systemInstructions,input:request.messages,max_output_tokens:4096,max_tool_calls:12,
      tools:[{type:"mcp",server_label:"oscar_next",server_description:"Bounded read-only OSCAR measurements without patient identity",tunnel_id:this.config.tunnelId,...(request.toolAuthorization?{authorization:request.toolAuthorization}:{}),allowed_tools:{read_only:true,tool_names:Object.keys(toolRegistry).map(name=>`oscar_${name}`)},require_approval:"never"}],
    })});
    if(!response.body)throw new Error("OpenAI returned no response stream");
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="",total=0,received=0,complete=false;
    try {
      while(true){request.signal.throwIfAborted();const {value,done}=await reader.read();if(done)break;received+=value.byteLength;if(received>4_000_000)throw new Error("OpenAI stream exceeded the response limit");buffer=(buffer+decoder.decode(value,{stream:true})).replace(/\r\n/g,"\n");if(buffer.length>1_000_000)throw new Error("OpenAI stream exceeded the response limit");
        let boundary:number;while((boundary=buffer.indexOf("\n\n"))>=0){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const data=frame.split("\n").filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trim()).join("\n");if(!data||data==="[DONE]")continue;
          let event:any;try{event=JSON.parse(data);}catch{throw new Error("OpenAI returned an invalid response stream");}
          if(event.type==="response.output_text.delta" && typeof event.delta==="string"){total+=event.delta.length;if(total>64_000)throw new Error("AI answer exceeded the response limit");yield {type:"text_delta",text:event.delta};}
          else if(event.type==="response.mcp_call.in_progress")yield {type:"status",text:"Retrieving read-only OSCAR measurements…"};
          else if(event.type==="response.completed")complete=true;
          else if(["error","response.failed","response.incomplete","response.mcp_call.failed"].includes(event.type))throw new Error("OpenAI analysis could not complete; check model, tunnel, MCP and selected dates");
        }
      }
      if(!complete || !total)throw new Error("OpenAI response ended before a complete answer was received");
    } finally { await reader.cancel().catch(()=>{});reader.releaseLock(); }
  }
}
