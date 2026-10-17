import { readFile, writeFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import type { TunnelStatus } from "../../contracts.js";

export interface TunnelChild { once(event:string,callback:(...args:any[])=>void):unknown; kill(signal?:string):boolean; }
interface TunnelConfig {tunnelId:string;runtimeKey:string;mcpUrl:string;mcpToken:string;}
export interface TunnelDependencies {
  verify():Promise<string>;
  launch(file:string,args:string[],env:Record<string,string|undefined>):TunnelChild;
  probe(url:string):Promise<boolean>;
  readHealthUrl(path:string):Promise<string>;
  now?():number;
}
async function verifiedBinary():Promise<string>{
  // This manifest is deployment-owned, never writable through renderer APIs.
  const manifestPath=process.env.OSCAR_TUNNEL_MANIFEST;
  if(!manifestPath)throw new Error("Tunnel client is not provisioned; install the verified runtime bundle");
  try{
    const manifest=JSON.parse(await readFile(manifestPath,"utf8")) as {file:string;sha256:string;version:string};
    if(!manifest.file||!/^([a-f0-9]{64})$/i.test(manifest.sha256)||!/^v?\d+\.\d+\.\d+$/.test(manifest.version))throw new Error();
    const path=resolve(dirname(manifestPath),manifest.file);if(!(await stat(path)).isFile())throw new Error();
    if(createHash("sha256").update(await readFile(path)).digest("hex").toLowerCase()!==manifest.sha256.toLowerCase())throw new Error();
    const version=await new Promise<string>((resolve,reject)=>execFile(path,["--version"],{windowsHide:true,timeout:5000,maxBuffer:16_384},(error,stdout)=>error?reject(error):resolve(stdout)));
    if(!version.includes(manifest.version))throw new Error();return path;
  }catch{throw new Error("Tunnel client is missing or failed integrity/version verification");}
}
const defaultDependencies:TunnelDependencies={verify:verifiedBinary,launch:(file,args,env)=>spawn(file,args,{env,stdio:"ignore",windowsHide:true,shell:false}),probe:async url=>{try{const response=await fetch(url,{signal:AbortSignal.timeout(2000),redirect:"error"});await response.body?.cancel();return response.ok;}catch{return false;}},readHealthUrl:path=>readFile(path,"utf8")};
export class TunnelManager {
  #status:TunnelStatus={state:"stopped",process:false,healthy:false,ready:false,attempts:0,error:null};
  #child:TunnelChild|undefined;
  #config:TunnelConfig|undefined;
  #directory:string|undefined;
  #timer:ReturnType<typeof setTimeout>|undefined;
  #stopping=false;
  #operation:Promise<void>|undefined;
  #startedAt=0;
  #failures=0;
  constructor(private readonly deps:TunnelDependencies=defaultDependencies,private readonly intervalMs=2000,private readonly maxRestarts=3){}
  getStatus():TunnelStatus{return {...this.#status};}
  async configure(config:TunnelConfig):Promise<void>{await this.stop();this.#config=config;this.#status.attempts=0;await this.start();}
  async start():Promise<void>{
    if(this.#operation)return this.#operation;if(this.#child)return;
    this.#stopping=false;this.#operation=this.launch();try{await this.#operation;}finally{this.#operation=undefined;}
  }
  private async launch():Promise<void>{
    const config=this.#config;if(!config)return;
    this.#status={...this.#status,state:"starting",process:false,healthy:false,ready:false,error:null};
    try{
      if(!config.runtimeKey||!config.tunnelId)throw new Error("Configure tunnel ID and runtime key in Settings");
      const binary=await this.deps.verify();if(this.#stopping)return;
      this.#directory=await mkdtemp(join(tmpdir(),"oscar-tunnel-"));
      const healthFile=join(this.#directory,"health.url"),configPath=join(this.#directory,"runtime.json");
      // JSON is valid YAML. Secret values resolve from environment, never argv/files.
      const clientCert=process.env.CONTROL_PLANE_CLIENT_CERT,clientKey=process.env.CONTROL_PLANE_CLIENT_KEY;
      if(!!clientCert!==!!clientKey)throw new Error("Control-plane mTLS requires both certificate and key files");
      await writeFile(configPath,JSON.stringify({control_plane:{base_url:clientCert?"https://mtls.api.openai.com":"https://api.openai.com",tunnel_id:config.tunnelId,api_key:"env:CONTROL_PLANE_API_KEY",...(clientCert?{client_cert:clientCert,client_key:clientKey}:{})},mcp:{server_urls:[{channel:"main",url:config.mcpUrl}],extra_headers:{"X-Oscar-Tunnel":"env:OSCAR_MCP_AUTH"},discovery_extra_headers:{Authorization:"env:OSCAR_MCP_DISCOVERY_AUTH","X-Oscar-Tunnel":"env:OSCAR_MCP_AUTH"}},health:{listen_addr:"127.0.0.1:0",url_file:healthFile},log:{level:"warn"}}),{mode:0o600});
      if(this.#stopping){await this.cleanup();return;}
      const env:Record<string,string|undefined>={};for(const key of ["SystemRoot","WINDIR","PATH","HOME","USERPROFILE","TEMP","TMP","HTTPS_PROXY","HTTP_PROXY","NO_PROXY","SSL_CERT_FILE","SSL_CERT_DIR"])if(process.env[key])env[key]=process.env[key];
      env.CONTROL_PLANE_API_KEY=config.runtimeKey;env.OSCAR_MCP_AUTH=config.mcpToken;env.OSCAR_MCP_DISCOVERY_AUTH=`Bearer ${config.mcpToken}`;
      const child=this.deps.launch(binary,["run","--config",configPath,"--log.http-raw-unsafe=false"],env);this.#child=child;this.#startedAt=this.deps.now?.()??Date.now();this.#failures=0;
      this.#status.process=true;
      const exited=()=>{if(this.#child!==child)return;this.#child=undefined;this.#status={...this.#status,process:false,healthy:false,ready:false,state:"disconnected",error:"Tunnel process stopped; check runtime credentials and outbound HTTPS"};if(!this.#stopping)this.scheduleRecovery();};
      child.once("exit",exited);child.once("error",exited);this.scheduleMonitor(healthFile);
    }catch(error){this.#status={...this.#status,state:"failed",process:false,healthy:false,ready:false,error:error instanceof Error?error.message:"Tunnel startup failed"};await this.cleanup();}
  }
  private scheduleMonitor(healthFile:string){this.#timer=setTimeout(()=>{void this.monitor(healthFile);},this.intervalMs);}
  private async monitor(healthFile:string):Promise<void>{
    const child=this.#child;if(!child||this.#stopping)return;
    let healthy=false,ready=false;
    try{const url=new URL((await this.deps.readHealthUrl(healthFile)).trim());if(url.protocol!=="http:"||url.hostname!=="127.0.0.1"||!url.port||url.username||url.password)throw new Error();
      [healthy,ready]=await Promise.all([this.deps.probe(`${url.origin}/healthz`),this.deps.probe(`${url.origin}/readyz`)]);
    }catch{/* A missing health file is expected briefly during startup. */}
    if(this.#stopping||this.#child!==child)return;
    const uptime=(this.deps.now?.()??Date.now())-this.#startedAt;
    this.#status.healthy=healthy;this.#status.ready=healthy&&ready;this.#status.state=healthy&&ready?"connected":uptime<30_000?"starting":"disconnected";
    if(healthy&&ready){this.#failures=0;this.#status.error=null;}
    else if(uptime>=30_000&&++this.#failures>=3){this.#status.error="Tunnel health/readiness failed; check runtime key and outbound HTTPS";await this.terminate();this.scheduleRecovery();return;}
    this.scheduleMonitor(healthFile);
  }
  private scheduleRecovery(){
    if(this.#timer)clearTimeout(this.#timer);if(this.#stopping)return;
    if(this.#status.attempts>=this.maxRestarts){this.#status.state="failed";return;}
    this.#status.attempts++;this.#timer=setTimeout(()=>{void this.cleanup().then(()=>this.start());},Math.min(30_000,this.intervalMs*2**(this.#status.attempts-1)));
  }
  async restart():Promise<void>{const config=this.#config;await this.stop();this.#status.attempts=0;if(config){this.#config=config;await this.start();}}
  private async terminate():Promise<void>{
    const child=this.#child;this.#child=undefined;if(!child)return;
    await new Promise<void>(resolve=>{let finished=false;const done=()=>{if(finished)return;finished=true;clearTimeout(timer);resolve();};const timer=setTimeout(()=>{child.kill("SIGKILL");done();},3000);child.once("exit",done);child.once("error",done);child.kill("SIGTERM");});
    this.#status.process=false;this.#status.healthy=false;this.#status.ready=false;
  }
  private async cleanup(){const directory=this.#directory;this.#directory=undefined;if(directory)await rm(directory,{recursive:true,force:true}).catch(()=>{});}
  async stop():Promise<void>{this.#stopping=true;this.#config=undefined;if(this.#timer)clearTimeout(this.#timer);this.#timer=undefined;await this.#operation?.catch(()=>{});await this.terminate();await this.cleanup();this.#status={...this.#status,state:"stopped",process:false,healthy:false,ready:false};}
}
