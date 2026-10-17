import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as z from "zod/v4";

export interface SecretCodec { encrypt(value:string):string; decrypt(value:string):string; }
const secretSchema = z.string().trim().min(1).max(4096).refine(value => !/[\r\n\0]/.test(value));

// Shared persistence contract for cloud providers: encrypted secrets when an OS
// codec exists; otherwise secrets remain in backend memory only.
export class SecureConfigurationStore<S extends object, K extends string> {
  #memory: Partial<Record<K,string>> = {};
  #writing = false;
  readonly #persistedSchema: z.ZodType;
  constructor(readonly path:string, private readonly codec:SecretCodec|undefined, private readonly settingsSchema:z.ZodType<S>, private readonly defaults:S, private readonly keys:readonly K[], private readonly label:string) {
    this.#persistedSchema = z.object({settings:settingsSchema,...Object.fromEntries(keys.map(key => [key,z.string().optional()]))}).strict();
  }
  forgetCredentials():void { this.#memory = {}; }
  private async load():Promise<{settings:S}&Partial<Record<K,string>>> {
    try { return this.#persistedSchema.parse(JSON.parse(await readFile(this.path,"utf8"))) as {settings:S}&Partial<Record<K,string>>; }
    catch(error) { if((error as {code?:string}).code==="ENOENT") return {settings:{...this.defaults}} as {settings:S}&Partial<Record<K,string>>; throw new Error(`Cannot read ${this.label} settings; restore or replace the configuration file`); }
  }
  protected async snapshot() {
    const value=await this.load(), configured={} as Record<K,boolean>;
    for(const key of this.keys) configured[key]=!!(value[key]||this.#memory[key]);
    return {settings:value.settings,configured,secretStorage:this.codec?"os-encrypted" as const:"memory-only" as const};
  }
  async credentials():Promise<Record<K,string>> {
    const value=await this.load(), result={} as Record<K,string>;
    try { for(const key of this.keys)result[key]=value[key]?(this.codec?.decrypt(value[key]!)??""):this.#memory[key]??"";return result; }
    catch { throw new Error("OS credential storage is unavailable for this account"); }
  }
  protected async save(raw:unknown):Promise<void> {
    if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error(`Invalid ${this.label} settings`);
    const values=raw as Record<string,unknown>, settings={...values},updates={} as Partial<Record<K,string|null>>;
    for(const key of this.keys){delete settings[key];if(values[key]!==undefined){if(values[key]===null)updates[key]=null;else {const parsed=secretSchema.safeParse(values[key]);if(!parsed.success)throw new Error(`Invalid ${this.label} settings`);updates[key]=parsed.data;}}}
    const parsed=this.settingsSchema.safeParse(settings);if(!parsed.success)throw new Error(`Invalid ${this.label} settings`);
    if(this.#writing)throw new Error("Settings are being saved; try again");this.#writing=true;
    const temp=`${this.path}.${randomUUID()}.tmp`;
    try {
      const previous=await this.load(),next:Partial<Record<K,string>>={},memory={...this.#memory};
      for(const key of this.keys){const value=updates[key];if(value===undefined){if(previous[key])next[key]=previous[key];}else if(value===null)delete memory[key];else if(this.codec){next[key]=this.codec.encrypt(value);delete memory[key];}else memory[key]=value;}
      await writeFile(temp,JSON.stringify({settings:parsed.data,...next}),{mode:0o600});await rename(temp,this.path);this.#memory=memory;
    }catch { throw new Error(`Unable to save ${this.label} settings securely`); }
    finally { this.#writing=false;await rm(temp,{force:true}).catch(()=>{}); }
  }
}
