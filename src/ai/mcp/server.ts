import { createServer } from "node:http";
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { toolRegistry } from "../../expert/tools.js";
import type { Range, Scope } from "../contracts.js";
import { ScopedCloudTools } from "../tools/scoped-tools.js";

interface Lease {tools:ScopedCloudTools;expires:number;authorization:string;}
export class PrivateAIMcp {
  #server:any;
  #url="";
  #lease:Lease|undefined;
  #starting:Promise<void>|undefined;
  readonly token=randomUUID();
  constructor(private readonly databasePath:string){}
  get url(){return this.#url;}
  authorize(scope:Scope,ranges:Range[]):string {const token=randomUUID();this.#lease={tools:new ScopedCloudTools(this.databasePath,scope,ranges),expires:Date.now()+180_000,authorization:`Bearer ${token}`};return token;}
  revoke():void{this.#lease=undefined;}
  private createServer(authorization:string):McpServer{
    const server=new McpServer({name:"oscar-ai",version:"1.0.0"});
    for(const [name,tool]of Object.entries(toolRegistry))server.registerTool(`oscar_${name}`,{description:tool.description,inputSchema:tool.schema,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async(args:unknown)=>{
      try{
        const lease=this.#lease;if(!lease||lease.authorization!==authorization||lease.expires<Date.now())throw new Error("Inactive analysis");
        const text=lease.tools.call(name,tool.schema.parse(args));
        return {content:[{type:"text" as const,text}]};
      }catch{return {isError:true,content:[{type:"text" as const,text:"OSCAR data unavailable: check selected dates, scope, coverage and bounded read-only tool limits."}]};}
    });return server;
  }
  async start():Promise<void>{if(this.#starting)return this.#starting;if(this.#server)return;this.#starting=this.listen();try{await this.#starting;}finally{this.#starting=undefined;}}
  private async listen():Promise<void>{
    if(this.#server)return;
    const http=createServer(async(req,res)=>{
      const expected=Buffer.from(this.token),actual=Buffer.from(String(req.headers["x-oscar-tunnel"]??""));
      const authorization=String(req.headers.authorization??"");
      if(req.url!=="/mcp"||req.headers.origin||!/^127\.0\.0\.1:\d+$/.test(String(req.headers.host))||expected.length!==actual.length||!timingSafeEqual(expected,actual)||(authorization!==`Bearer ${this.token}`&&authorization!==this.#lease?.authorization)){res.writeHead(403);res.end();return;}
      const server=this.createServer(authorization),transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
      try{
        const chunks:Uint8Array[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>32_768)throw new Error("Request too large");chunks.push(chunk);}
        const headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(typeof value==="string")headers.set(key,value);
        const body=Buffer.concat(chunks).toString("utf8");
        await server.connect(transport);
        const result=await transport.handleRequest(new Request(this.#url,{method:req.method,headers,...(body?{body}:{})}));
        res.writeHead(result.status,Object.fromEntries(result.headers.entries()));res.end(new Uint8Array(await result.arrayBuffer()));
      }catch{if(!res.headersSent)res.writeHead(400);res.end();}finally{await transport.close();await server.close();}
    });
    await new Promise<void>((resolve,reject)=>{http.once("error",reject);http.listen(0,"127.0.0.1",()=>{http.off("error",reject);resolve();});});
    this.#server=http;this.#url=`http://127.0.0.1:${http.address().port}/mcp`;
  }
  async check():Promise<string[]>{
    const rpc=async(method:string,id?:number,params:unknown={})=>{
      const response=await fetch(this.url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(5000),headers:{authorization:`Bearer ${this.token}`,"x-oscar-tunnel":this.token,"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",...(id===undefined?{}:{id}),method,params})});
      if(!response.ok)throw new Error("Local OSCAR MCP is unavailable");return response.status===202?{}:await response.json() as any;
    };
    const init=await rpc("initialize",1,{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"oscar-ai-diagnostics",version:"1"}});if(!init.result?.capabilities)throw new Error("OSCAR MCP initialization failed");
    await rpc("notifications/initialized");const list=await rpc("tools/list",2);const tools=list.result?.tools as any[];
    const expected=Object.keys(toolRegistry).map(name=>`oscar_${name}`);
    if(!Array.isArray(tools)||tools.length!==expected.length||tools.some(tool=>!expected.includes(tool.name)||tool.annotations?.readOnlyHint!==true||tool.annotations?.destructiveHint!==false||tool.annotations?.openWorldHint!==false))throw new Error("OSCAR MCP read-only validation failed");
    return tools.map(tool=>tool.name);
  }
  async close():Promise<void>{this.revoke();await this.#starting?.catch(()=>{});const server=this.#server;this.#server=undefined;this.#url="";if(server)await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections?.();});}
}
