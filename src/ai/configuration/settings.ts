import * as z from "zod/v4";
import type { AISettingsView, GroqSettingsView } from "../contracts.js";
import { SecureConfigurationStore, type SecretCodec } from "./secure-store.js";
export type { SecretCodec } from "./secure-store.js";

const settingsSchema=z.object({enabled:z.boolean(),provider:z.literal("openai"),model:z.string().trim().regex(/^[a-zA-Z0-9._:-]{1,150}$/),tunnelEnabled:z.boolean(),tunnelId:z.string().trim().max(100).refine(v=>!v||/^tunnel_[a-zA-Z0-9_-]+$/.test(v))}).strict();
const defaults={enabled:false,provider:"openai" as const,model:"gpt-4.1",tunnelEnabled:false,tunnelId:""};
export class AISettingsStore extends SecureConfigurationStore<z.infer<typeof settingsSchema>,"apiKey"|"runtimeKey"> {
  constructor(path:string,codec?:SecretCodec){super(path,codec,settingsSchema,defaults,["apiKey","runtimeKey"],"OSCAR AI");}
  async view():Promise<AISettingsView>{const value=await this.snapshot();return {...value.settings,apiKeyConfigured:value.configured.apiKey,runtimeKeyConfigured:value.configured.runtimeKey,secretStorage:value.secretStorage};}
  async configure(raw:unknown):Promise<AISettingsView>{await this.save(raw);return this.view();}
}

export const groqSettingsSchema=z.object({enabled:z.boolean(),provider:z.literal("groq"),model:z.string().trim().regex(/^[a-zA-Z0-9._:/-]{1,150}$/)}).strict();
export class GroqSettingsStore extends SecureConfigurationStore<z.infer<typeof groqSettingsSchema>,"apiKey"> {
  constructor(path:string,codec?:SecretCodec){super(path,codec,groqSettingsSchema,{enabled:false,provider:"groq",model:"llama-3.3-70b-versatile"},["apiKey"],"Groq");}
  async view():Promise<GroqSettingsView>{const value=await this.snapshot();return {...value.settings,apiKeyConfigured:value.configured.apiKey,secretStorage:value.secretStorage};}
  async configure(raw:unknown):Promise<GroqSettingsView>{await this.save(raw);return this.view();}
}
