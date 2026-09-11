import type { TableNode } from './types';
export type BusinessType = 'Text' | 'Number' | 'Boolean' | 'Date';
export interface Attribute { id:string; name:string; definition:string; type:BusinessType; required:boolean; identifier:boolean }
export interface Representation { id:string; name:string; purpose:string; tableId:string; bindings:Record<string,string> }
export interface Entity { id:string; name:string; definition:string; grain:string; rules:string; x:number; y:number; pinned?:boolean; attributes:Attribute[]; representations:Representation[] }
export interface BusinessRelationship { id:string; from:string; to:string; name:string; cardinality:string; optional:boolean }
export interface BusinessModel { version:1; entities:Entity[]; relationships:BusinessRelationship[]; metrics:Metric[] }
export function bindingIssue(attribute:Attribute, columnId:string|undefined, table:TableNode|undefined):string {
  if (!columnId) return 'Unmapped';
  const col = table?.columns.find(c=>c.id===columnId);
  if (!col) return 'Missing physical column';
  const type = col.type === 'BOOLEAN' ? 'Boolean' : ['DATE','TIMESTAMP'].includes(col.type) ? 'Date' : ['TINYINT','SMALLINT','INT','BIGINT','FLOAT','DOUBLE','DECIMAL'].includes(col.type) ? 'Number' : 'Text';
  return type === attribute.type ? '' : `Type mismatch: ${col.type}`;
}
export function coverage(entity:Entity, tables:TableNode[]):string {
  const total=entity.attributes.length*entity.representations.length;
  const mapped=entity.representations.reduce((sum,r)=>sum+entity.attributes.filter(a=>!bindingIssue(a,r.bindings[a.id],tables.find(t=>t.id===r.tableId))).length,0);
  return !mapped || !total ? 'Unmapped' : mapped===total ? 'Mapped' : 'Partially mapped';
}
export function seedBusiness(tables:TableNode[]):BusinessModel {
  const model:BusinessModel={version:1,entities:[],relationships:[],metrics:[]};
  const specs:[string,string,string,[string,string, BusinessType,boolean][]][]=[
    ['Customer','dim_customer','One customer',[['Customer ID','customer_id','Text',true],['Name','customer_name','Text',false],['Country code','country_code','Text',false]]],
    ['Product','dim_product','One product',[['Product code','product_code','Text',true],['Name','product_name','Text',false],['Category','category','Text',false]]],
    ['Order','order_line','One order, identified by Order ID',[['Order ID','order_id','Text',true]]],
    ['Order Line','order_line','One line within an order',[['Order ID','order_id','Text',true],['Line number','line_no','Number',true],['Quantity','quantity','Number',false],['Net amount','net_amount','Number',false],['Order date','order_date','Date',false]]],
    ['Invoice','invoice','One invoice',[['Invoice ID','invoice_id','Text',true],['Invoice date','invoice_date','Date',false],['Due date','due_date','Date',false],['Outstanding amount','outstanding_amount','Number',false]]],
  ];
  specs.forEach(([name,physical,grain,attrs],i)=>{
    const table=tables.find(t=>t.name===physical);
    const entity:Entity={id:crypto.randomUUID(),name,definition:`Business concept: ${name.toLowerCase()}.`,grain,rules:name==='Order'?'The physical representation contains multiple lines per order. Use distinct Order ID to identify orders.':'',x:80+(i%3)*330,y:100+Math.floor(i/3)*330,attributes:attrs.map(([name,,type,identifier])=>({id:crypto.randomUUID(),name,definition:'',type,required:identifier,identifier})),representations:[]};
    if(table) entity.representations.push({id:crypto.randomUUID(),name:'Warehouse',purpose:table.schema==='gold'?'Curated warehouse':'Conformed warehouse',tableId:table.id,bindings:Object.fromEntries(entity.attributes.flatMap((a,index)=>{const col=table.columns.find(c=>c.name===attrs[index][1]);return col?[[a.id,col.id]]:[];}))});
    model.entities.push(entity);
  });
  for(const [from,to,name,cardinality] of [[0,2,'places','One to many'],[2,3,'contains','One to many'],[1,3,'appears on','One to many'],[0,4,'receives','One to many'],[2,4,'is billed by','One to many']] as const) model.relationships.push({id:crypto.randomUUID(),from:model.entities[from].id,to:model.entities[to].id,name,cardinality,optional:true});
  const lines=model.entities.find(e=>e.name==='Order Line')!;
  model.metrics.push({id:crypto.randomUUID(),name:'Net revenue',definition:'Sum of net order-line amounts. Review cancellation and recognition rules before use.',entityId:lines.id,attributeId:lines.attributes.find(a=>a.name==='Net amount')!.id,aggregation:'Sum',timeAttributeId:lines.attributes.find(a=>a.name==='Order date')!.id,dimensions:[],filters:'',representationId:lines.representations[0]?.id??'',x:1100,y:450});
  return model;
}
export function decodeBusiness(raw:string):BusinessModel {
  const value=JSON.parse(raw);
  if(value.version!==1||!Array.isArray(value.entities)||!Array.isArray(value.relationships)) throw Error('Invalid business model');
  for(const e of value.entities) {
    if(typeof e.id!=='string'||typeof e.name!=='string'||typeof e.definition!=='string'||typeof e.grain!=='string'||typeof e.rules!=='string'||!Number.isFinite(e.x)||!Number.isFinite(e.y)||!Array.isArray(e.attributes)||!Array.isArray(e.representations)) throw Error('Invalid entity');
    for(const a of e.attributes) if(typeof a.id!=='string'||typeof a.name!=='string'||typeof a.definition!=='string'||!['Text','Number','Boolean','Date'].includes(a.type)||typeof a.required!=='boolean'||typeof a.identifier!=='boolean') throw Error('Invalid attribute');
    for(const r of e.representations) if(typeof r.id!=='string'||typeof r.name!=='string'||typeof r.purpose!=='string'||typeof r.tableId!=='string'||!r.bindings||typeof r.bindings!=='object'||Object.values(r.bindings).some(v=>typeof v!=='string')) throw Error('Invalid representation');
  }
  for(const r of value.relationships) if(typeof r.id!=='string'||typeof r.from!=='string'||typeof r.to!=='string'||typeof r.name!=='string'||typeof r.cardinality!=='string'||typeof r.optional!=='boolean') throw Error('Invalid relationship');
  value.metrics ??= [];
  if(!Array.isArray(value.metrics))throw Error('Invalid metrics');
  for(const m of value.metrics) {
    for(const key of ['id','name','definition','entityId','attributeId','timeAttributeId','filters','representationId'])if(typeof m[key]!=='string')throw Error('Invalid metric');
    if(!['Sum','Average','Count','Distinct count','Minimum','Maximum'].includes(m.aggregation)||!Array.isArray(m.dimensions)||m.dimensions.some((v:unknown)=>typeof v!=='string')||!Number.isFinite(m.x)||!Number.isFinite(m.y))throw Error('Invalid metric');
  }
  return value;
}

export interface Metric {
  id:string; name:string; definition:string; entityId:string; attributeId:string;
  aggregation:'Sum'|'Average'|'Count'|'Distinct count'|'Minimum'|'Maximum';
  timeAttributeId:string; dimensions:string[]; filters:string; representationId:string;
  x:number; y:number; pinned?:boolean;
}
export function metricIssues(metric:Metric,model:BusinessModel,tables:TableNode[]):string[] {
  const issues:string[]=[];
  const entity=model.entities.find(e=>e.id===metric.entityId);
  if(!metric.name.trim())issues.push('Name is required');
  if(!entity)return [...issues,'Choose a business entity'];
  const attribute=entity.attributes.find(a=>a.id===metric.attributeId);
  if(!attribute)issues.push('Choose a value attribute');
  else if(['Sum','Average'].includes(metric.aggregation)&&attribute.type!=='Number')issues.push('This aggregation requires a numeric attribute');
  const rep=entity.representations.find(r=>r.id===metric.representationId);
  if(!rep)issues.push('Choose a physical representation');
  else {
    for(const id of [...new Set([metric.attributeId,metric.timeAttributeId,...metric.dimensions].filter(Boolean))]) {
      const a=entity.attributes.find(a=>a.id===id);
      if(!a){issues.push('An attribute no longer exists');continue;}
      const issue=bindingIssue(a,rep.bindings[a.id],tables.find(t=>t.id===rep.tableId));
      if(issue)issues.push(`${a.name}: ${issue}`);
    }
  }
  if(metric.timeAttributeId&&entity.attributes.find(a=>a.id===metric.timeAttributeId)?.type!=='Date')issues.push('Time basis must be a date attribute');
  return issues;
}
