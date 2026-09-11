import {bindingIssue,type Entity} from './business-model';
import type {TableNode} from './types';
import {isReadOnly} from './sharing';
const choices=new Map<string,{repId?:string;attributeId?:string}>();
export function mappingWorkspace(entity:Entity,tables:TableNode[],save:()=>void,trace:(table:string,column:string)=>void){
 const root=document.createElement('section');root.className='mapping-workspace';
 const previous=choices.get(entity.id);let repId=entity.representations.find(r=>r.id===previous?.repId)?.id??entity.representations[0]?.id,attributeId=entity.attributes.find(a=>a.id===previous?.attributeId)?.id??entity.attributes[0]?.id,query='';
 const el=(tag:string,text='',cls='')=>{const e=document.createElement(tag);e.textContent=text;e.className=cls;return e;};
 const button=(label:string,fn:()=>void,edit=false)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=fn;b.disabled=edit&&isReadOnly();return b;};
 function render(){
 choices.set(entity.id,{repId,attributeId});root.replaceChildren();const rep=entity.representations.find(r=>r.id===repId),attribute=entity.attributes.find(a=>a.id===attributeId);
 const top=el('div','','mapping-top');const select=document.createElement('select');select.setAttribute('aria-label','Representation');for(const r of entity.representations)select.add(new Option(`${r.name} · ${r.purpose}`,r.id));select.value=repId??'';select.onchange=()=>{repId=select.value;query='';render();};select.dataset.readonlyNavigation='true';
 top.append(select,button('+ Representation',()=>{const r={id:crypto.randomUUID(),name:'New representation',purpose:'Warehouse',tableId:'',bindings:{}};entity.representations.push(r);repId=r.id;save();render();},true));root.append(top);
 if(!rep){root.append(el('p','Add a representation to start mapping.'));return;}
 const settings=el('details');settings.append(el('summary','Representation settings'));
 for(const key of ['name','purpose'] as const){const label=el('label',key==='name'?'Name':'Purpose');const input=document.createElement('input');input.value=rep[key];input.setAttribute('aria-label',`Representation ${key}`);input.oninput=()=>{rep[key]=input.value;save();};label.append(input);settings.append(label);}
 settings.append(button('Remove representation',()=>{if(!confirm('Remove this representation and its bindings?'))return;entity.representations=entity.representations.filter(r=>r!==rep);repId=entity.representations[0]?.id;save();render();},true));root.append(settings);
 const sides=el('div','','mapping-sides'),left=el('div','','mapping-attributes'),right=el('div','','mapping-columns');sides.append(left,right);root.append(sides);
 const table=tables.find(t=>t.id===rep.tableId);
 left.append(el('h3','Business attributes'));
 for(const a of entity.attributes){const issue=bindingIssue(a,rep.bindings[a.id],table),column=table?.columns.find(c=>c.id===rep.bindings[a.id]);const row=el('div','','mapping-binding');row.classList.toggle('active',a.id===attributeId);
 const pick=button(`${a.name}${a.identifier?' · ID':''}`,()=>{attributeId=a.id;render();});pick.setAttribute('aria-pressed',String(a.id===attributeId));pick.dataset.readonlyNavigation='true';row.append(pick,el('small',a.type));
 row.append(el('p',column?`${table!.name}.${column.name}`:'Unmapped'));if(issue)row.append(el('small',issue,'business-issue'));
 const actions=el('div','','mapping-binding-actions');if(column){const go=button('Trace',()=>trace(table!.id,column.id));go.setAttribute('aria-label',`Trace ${a.name}`);actions.append(go);}if(rep.bindings[a.id])actions.append(button('Remove',()=>{delete rep.bindings[a.id];save();render();},true));row.append(actions);left.append(row);}
 if(!entity.attributes.length)left.append(el('p','Add attributes in Definition first.'));
 right.append(el('h3',attribute?`Map ${attribute.name}`:'Physical columns'));
 const physical=document.createElement('select');physical.setAttribute('aria-label','Physical table');physical.add(new Option('Choose table…',''));for(const t of tables)physical.add(new Option([t.database,t.schema,t.name].filter(Boolean).join('.'),t.id));physical.value=rep.tableId;physical.onchange=()=>{if(Object.values(rep.bindings).some(Boolean)&&!confirm('Changing table clears this representation’s current bindings.')){physical.value=rep.tableId;return;}rep.tableId=physical.value;rep.bindings={};save();render();};right.append(physical);
 const filter=document.createElement('input');filter.type='search';filter.placeholder='Find physical column…';filter.value=query;filter.setAttribute('aria-label','Find physical column');filter.dataset.readonlyNavigation='true';right.append(filter);
 const results=el('div','','mapping-results');right.append(results);
 function list(){results.replaceChildren();const normal=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
 for(const c of table?.columns.filter(c=>c.name.toLowerCase().includes(query.toLowerCase()))??[]){const issue=attribute?bindingIssue(attribute,c.id,table):'Choose an attribute';const row=el('div','','mapping-candidate');row.append(el('strong',c.name),el('small',c.type.toLowerCase()));
 if(attribute&&!issue&&normal(attribute.name)===normal(c.name))row.append(el('small','Suggested match','mapping-suggestion'));
 if(issue)row.append(el('small',issue,'business-issue'));
 const bind=button(attribute&&rep!.bindings[attribute.id]===c.id?'Mapped':'Map',()=>{if(!attribute)return;rep!.bindings[attribute.id]=c.id;save();render();},true);bind.disabled=bind.disabled||!!issue||!!(attribute&&rep!.bindings[attribute.id]===c.id);row.append(bind);results.append(row);}
 if(!results.children.length)results.append(el('p',table?'No matching columns.':'Choose a physical table.'));
 }filter.oninput=()=>{query=filter.value;list();};list();
 }
 render();return root;
}
