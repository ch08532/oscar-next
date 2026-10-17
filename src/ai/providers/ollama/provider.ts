import type { AIEvent, AIRequest, Range } from "../../contracts.js";
import type { AIProvider, ProviderRequest } from "../provider.js";
import { analysisInput } from "../../analysis.js";
import { expertService, type ExpertService } from "../../../expert/service.js";
import { requestSchema, type ExpertRequest, type ReviewResult } from "../../../expert/schemas.js";

export function localReviewRequest(request:AIRequest,ranges:Range[]):ExpertRequest {
  const scope={profileId:request.profileId,machineId:request.machineId};
  if(request.dateMode==="single")return requestSchema.parse({...scope,reviewType:"night",date:request.date,question:analysisInput(request)});
  if(request.dateMode==="range")return requestSchema.parse({...scope,reviewType:"trend",date:request.endDate,range:{startDate:request.startDate,endDate:request.endDate},question:analysisInput(request)});
  if(request.dateMode==="compare")return requestSchema.parse({...scope,reviewType:"trend",date:request.periodB.endDate,range:request.periodB,baseline:request.periodA,question:analysisInput(request)});
  const range=ranges.at(-1);if(!range)throw new Error("Choose an exact date range for this question");
  if(request.message.length>2000)throw new Error("Local Expert questions support at most 2,000 characters");
  return requestSchema.parse({...scope,reviewType:"question",date:range.endDate,range,...(ranges.length>1?{baseline:ranges[0]}:{}),question:request.message});
}
function reviewText(result:ReviewResult):string {
  const {review}=result;
  return [review.summary,...review.positiveFindings.map(item=>`${item.title}: ${item.explanation}`),...review.itemsToReview.map(item=>`${item.title}: ${item.explanation}`),...review.questionsForClinician.map(text=>`Clinician question: ${text}`),...review.limitations.map(text=>`Limitation: ${text}`)].join("\n\n");
}

// Reuse the existing local compatibility checks, orchestrator and validation.
// Incomplete local model output is never presented as a validated review.
export class LocalExpertProvider implements AIProvider {
  readonly #service: Pick<ExpertService,"start"|"job"|"check"|"forget">;
  constructor(databasePath:string,service?:Pick<ExpertService,"start"|"job"|"check"|"forget">){this.#service=service??expertService(databasePath);}
  getCapabilities(){return {streaming:false,tools:true,local:true};}
  async testConnection(signal:AbortSignal):Promise<void>{signal.throwIfAborted();const result=await this.#service.check();signal.throwIfAborted();if(!result.ready)throw new Error(result.message);}
  async ask(request:ProviderRequest):Promise<string>{let text="";for await(const event of this.stream(request))if(event.type==="text_delta")text+=event.text;return text;}
  async *stream(input:ProviderRequest):AsyncGenerator<AIEvent>{
    if(!input.analysis)throw new Error("Local Expert requires a structured analysis scope");
    input.signal.throwIfAborted();const request=localReviewRequest(input.analysis.request,input.analysis.ranges),scope={profileId:request.profileId,machineId:request.machineId};
    let job=await this.#service.start(request,input.messages.slice(0,-1));
    const cancel=()=>{try{this.#service.job(job.id,scope,true);}catch{/* An expired job has no active generation. */}};
    input.signal.addEventListener("abort",cancel,{once:true});let lastStatus="";
    try{
      while(true){input.signal.throwIfAborted();job=this.#service.job(job.id,scope);
        if(job.status!==lastStatus){lastStatus=job.status;yield {type:"status",text:job.status};}
        if(job.state==="complete"&&job.result){yield {type:"review",result:job.result};yield {type:"text_delta",text:reviewText(job.result)};return;}
        if(job.state!=="running")throw new Error(job.error??"Local Expert review was cancelled");
        await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);input.signal.removeEventListener("abort",done);resolve();};const timer=setTimeout(done,150);input.signal.addEventListener("abort",done,{once:true});if(input.signal.aborted)done();});
      }
    }finally{input.signal.removeEventListener("abort",cancel);if(job.state==="running")cancel();try{this.#service.forget(job.id,scope);}catch{/* It may already be gone. */}}
  }
}
