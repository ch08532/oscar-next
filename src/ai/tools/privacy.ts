// Cloud transport never serializes local scope/evidence IDs or identity fields.
// Keep this separate from ExpertTools so the existing local workflow is unchanged.
export function minimumCloudData(value:unknown):unknown {
  if(Array.isArray(value))return value.map(minimumCloudData);
  if(value && typeof value==="object"){
    const result:Record<string,unknown>={};
    for(const [key,child]of Object.entries(value)){
      if(/^(id|profileId|machineId|sessionId|name|email|address|serial|serialNumber|databasePath|path|username|accountId|deviceTimeZone|notes)$/i.test(key))continue;
      result[key]=minimumCloudData(child);
    }return result;
  }return value;
}
