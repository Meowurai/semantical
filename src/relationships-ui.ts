import {createElement,GitBranch,Network,Plus,Pencil,Trash2,X} from 'lucide';
import {beginHistory,commitHistory} from './history';
import {canAddSource} from './lineage';
import type {TableNode} from './types';
import type {BusinessModel} from './business-model';
import './relationships.css';

type Mode='lineage'|'semantics';
export function relationshipManager(tables:TableNode[],business:()=>BusinessModel,changed:()=>void,readOnly:()=>boolean){
  const dialog=document.createElement('dialog');dialog.className='relationships-dialog';document.body.append(dialog);
  let mode:Mode='lineage';
  const icon=(value:typeof Plus)=>createElement(value,{width:16,height:16,'aria-hidden':'true'});
  const button=(label:string,action:()=>void,symbol?:typeof Plus)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label',label);if(symbol)b.append(icon(symbol));else b.textContent=label;b.onclick=action;return b;};
  const labelTable=(id:string)=>{const table=tables.find(t=>t.id===id);return table?[table.database,table.schema,table.name].filter(Boolean).join('.')||'Untitled table':'Missing table';};
  const cardinalities=['One to one','One to many','Many to one','Many to many'];
  const shortCardinality:Record<string,string>={'One to one':'1:1','One to many':'1:N','Many to one':'N:1','Many to many':'N:N'};
  const mutate=(action:()=>void)=>{beginHistory();action();changed();commitHistory();render();};
  function render(){
    dialog.replaceChildren();const semantic=mode==='semantics';const model=business();
    const header=document.createElement('header');const title=document.createElement('h2');title.id='relationships-title';title.append(icon(semantic?Network:GitBranch),document.createTextNode(semantic?'Entity relationships':'Lineage relationships'));dialog.setAttribute('aria-labelledby',title.id);header.append(title,button('Close relationships',()=>dialog.close(),X));dialog.append(header);
    const controls=document.createElement('div');controls.className='relationship-controls';const search=document.createElement('input');search.type='search';search.placeholder='Filter relationships…';search.setAttribute('aria-label','Filter relationships');controls.append(search);
    if(!readOnly()){const add=button('Add relationship',()=>edit());add.prepend(icon(Plus));controls.append(add);}dialog.append(controls);
    const editor=document.createElement('div');editor.className='relationship-editor';editor.hidden=true;dialog.append(editor);
    const list=document.createElement('div');list.className='relationship-list';dialog.append(list);
    const rows=()=>semantic?model.relationships.map(r=>({key:r.id,from:r.from,to:r.to,name:r.name,cardinality:r.cardinality})):tables.flatMap(t=>t.upstream.map(from=>({key:JSON.stringify([from,t.id]),from,to:t.id,name:'',cardinality:''})));
    const name=(id:string)=>semantic?model.entities.find(e=>e.id===id)?.name||'Missing entity':labelTable(id);
    function drawList(){
      list.replaceChildren();const all=rows(),q=search.value.toLowerCase();const filtered=all.filter(r=>`${name(r.from)} ${name(r.to)} ${r.name} ${r.cardinality}`.toLowerCase().includes(q));
      const count=document.createElement('p');count.className='relationship-count';count.textContent=`${filtered.length} of ${all.length} relationships`;list.append(count);
      if(!filtered.length){const empty=document.createElement('p');empty.className='relationship-empty';empty.textContent=all.length?'No matching relationships.':semantic?'No entity relationships yet.':'No table lineage relationships yet.';list.append(empty);}
      for(const row of filtered){const item=document.createElement('article');item.className='relationship-item';const text=document.createElement('div');const endpoints=document.createElement('div');endpoints.className='relationship-endpoints';endpoints.textContent=`${name(row.from)} → ${name(row.to)}`;text.append(endpoints);
        if(semantic){const detail=document.createElement('p');detail.textContent=`${row.name} · ${shortCardinality[row.cardinality]??row.cardinality}${model.relationships.find(r=>r.id===row.key)?.optional?' · Optional':''}`;text.append(detail);}item.append(text);
        if(!readOnly()){const actions=document.createElement('div');actions.className='relationship-actions';actions.append(button('Edit relationship',()=>edit(row),Pencil),button('Remove relationship',()=>mutate(()=>{if(semantic)model.relationships=model.relationships.filter(r=>r.id!==row.key);else{const target=tables.find(t=>t.id===row.to)!;target.upstream=target.upstream.filter(id=>id!==row.from);}}),Trash2));item.append(actions);}list.append(item);
      }
    }
    search.oninput=drawList;drawList();
    function edit(existing?:ReturnType<typeof rows>[number]){
      editor.replaceChildren();editor.hidden=false;
      const form=document.createElement('form');const heading=document.createElement('strong');heading.textContent=existing?'Edit relationship':'Add relationship';form.append(heading);
      const field=(label:string,input:HTMLElement)=>{const wrapper=document.createElement('label');wrapper.textContent=label;wrapper.append(input);form.append(wrapper);};
      const options=semantic?model.entities.map(e=>[e.id,e.name]):tables.map(t=>[t.id,labelTable(t.id)]);
      const select=(label:string,value:string)=>{const input=document.createElement('select');input.setAttribute('aria-label',label);input.required=true;input.add(new Option('Choose…',''));for(const [id,text] of options)input.add(new Option(text,id));input.value=value;field(label,input);return input;};
      const from=select(semantic?'From entity':'Upstream table',existing?.from??'');const to=select(semantic?'To entity':'Downstream table',existing?.to??'');
      const relationName=document.createElement('input');relationName.setAttribute('aria-label','Relationship name');relationName.value=existing?.name??'';relationName.placeholder='e.g. places';
      const cardinality=document.createElement('select');cardinality.setAttribute('aria-label','Cardinality');for(const c of cardinalities)cardinality.add(new Option(`${shortCardinality[c]} · ${c}`,c));cardinality.value=existing?.cardinality||'One to many';
      const optional=document.createElement('input');optional.type='checkbox';optional.checked=existing?!!model.relationships.find(r=>r.id===existing.key)?.optional:true;optional.setAttribute('aria-label','Optional relationship');
      if(semantic){relationName.required=true;field('Relationship name',relationName);field('Cardinality',cardinality);field('Optional relationship',optional);}
      const error=document.createElement('p');error.role='alert';error.className='relationship-error';form.append(error);
      const actions=document.createElement('div');actions.className='relationship-form-actions';const save=document.createElement('button');save.type='submit';save.textContent=existing?'Save relationship':'Add relationship';actions.append(button('Cancel',()=>{editor.hidden=true;}),save);form.append(actions);editor.append(form);from.focus();
      form.onsubmit=e=>{e.preventDefault();error.textContent='';
        if(!from.value||!to.value){error.textContent='Choose both endpoints.';return;}
        if(semantic){if(!relationName.value.trim()){error.textContent='Enter a relationship name.';return;}if(model.relationships.some(r=>r.id!==existing?.key&&r.from===from.value&&r.to===to.value&&r.name===relationName.value.trim())){error.textContent='This relationship already exists.';return;}
          mutate(()=>{const values={from:from.value,to:to.value,name:relationName.value.trim(),cardinality:cardinality.value,optional:optional.checked};const current=model.relationships.find(r=>r.id===existing?.key);if(current)Object.assign(current,values);else model.relationships.push({id:crypto.randomUUID(),...values});});
        }else{const proposed=tables.map(t=>({...t,upstream:t.upstream.filter(id=>!(existing&&t.id===existing.to&&id===existing.from))}));if(!canAddSource(proposed,to.value,from.value)){error.textContent='Choose different tables. Duplicate links and cycles are not allowed.';return;}
          mutate(()=>{if(existing){const old=tables.find(t=>t.id===existing.to)!;old.upstream=old.upstream.filter(id=>id!==existing.from);}tables.find(t=>t.id===to.value)!.upstream.push(from.value);});}
      };
    }
  }
  document.addEventListener('historychange',()=>{if(dialog.open)render();});
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  return {open:(value:Mode)=>{mode=value;render();dialog.showModal();}};
}
