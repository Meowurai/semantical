import {decodeSnapshot} from './persistence';
import {decodeBusiness,type BusinessModel} from './business-model';
export interface ModelFile {format:'data-canvas';version:1;lineage:ReturnType<typeof decodeSnapshot>;semantics:BusinessModel}
export function encodeModelFile(physical:string,business:BusinessModel):string {
  return JSON.stringify({format:'data-canvas',version:1,lineage:decodeSnapshot(physical),semantics:business} satisfies ModelFile,null,2);
}
export function decodeModelFile(raw:string):ModelFile {
  const data=JSON.parse(raw);
  if(!data||data.format!=='data-canvas'||data.version!==1)throw Error('Choose a supported Semantical model file.');
  const lineage=decodeSnapshot(JSON.stringify(data.lineage));
  const semantics=decodeBusiness(JSON.stringify(data.semantics));
  const unique=(items:{id:string}[])=>{const ids=new Set<string>();for(const item of items){if(!item.id||ids.has(item.id))throw Error('The file contains duplicate or missing IDs.');ids.add(item.id);}};
  unique([...semantics.entities,...semantics.metrics]);unique(semantics.relationships);
  for(const entity of semantics.entities){unique(entity.attributes);unique(entity.representations);}
  return {format:'data-canvas',version:1,lineage,semantics};
}
