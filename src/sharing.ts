import {companyExample} from './company-example';
import {arrangeSemantic} from './semantic-layout';
import {encodeModelFile,decodeModelFile,type ModelFile} from './model-file';
import {getThemePreference,setThemePreference} from './theme';
import {undo,redo,historyState} from './history';
import {decodeSnapshot} from './persistence';
import {decodeBusiness,seedBusiness,type BusinessModel} from './business-model';
import {createElement,Menu,Lock, Pencil,Moon,Sun,Monitor,Undo2,Redo2,Trash2,Info,Download,Upload,FlaskConical} from 'lucide';
export interface SharedModel {version:1;id:string;mode:'view'|'edit';physical:string;business:string}
export let shared:SharedModel|undefined;
export const isReadOnly=()=>shared?.mode==='view';
export async function loadShared() {
  const hash=new URLSearchParams(location.hash.slice(1));const encoded=hash.get('share');if(!encoded)return;
  if(encoded.length>150000)throw new Error('This shared link is too large.');
  const bytes=Uint8Array.from(atob(encoded.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks:Uint8Array[]=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2000000){await reader.cancel();throw new Error('Shared model is too large.');}chunks.push(value);}
  const data=JSON.parse(await new Blob(chunks as BlobPart[]).text());
  if(data.version!==1||!['view','edit'].includes(data.mode)||typeof data.id!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(data.id))throw new Error('Invalid shared model.');
  decodeSnapshot(data.physical);decodeBusiness(data.business);shared=data;
}
export async function shareURL(physical:string,business:BusinessModel,mode:'view'|'edit') {
  const payload:SharedModel={version:1,id:crypto.randomUUID(),mode,physical,business:JSON.stringify(business)};
  const stream=new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes=new Uint8Array(await new Response(stream).arrayBuffer());
  const encoded=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  if(encoded.length>150000)throw new Error('This model is too large to share as a URL.');
  const url=new URL(location.href);url.search='';url.hash='share='+encoded;return url.href;
}
export function installShareMenu(nav:HTMLElement,snapshot:()=>string,business:()=>BusinessModel,clearCanvas:()=>{name:string;description:string;run:()=>void},importModel:(data:ModelFile)=>void) {
  const toggle=document.createElement('button');toggle.type='button';toggle.setAttribute('aria-label','Share menu');toggle.setAttribute('aria-expanded','false');toggle.append(createElement(Menu,{width:16,height:16,'aria-hidden':'true'}));
  const panel=document.createElement('div');panel.className='share-menu';panel.hidden=true;panel.setAttribute('aria-label','Model menu');
  const close=()=>{panel.hidden=true;toggle.setAttribute('aria-expanded','false');};
  toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));};
  if(!isReadOnly()){
    const actions=document.createElement('div');actions.className='history-actions';
    const back=document.createElement('button'),forward=document.createElement('button');for(const [button,label,icon,shortcut] of [[back,'Undo',Undo2,'⌘Z'],[forward,'Redo',Redo2,'⌘⇧Z']] as const){
      const key=document.createElement('kbd');key.textContent=shortcut;
      button.append(createElement(icon,{width:15,height:15,'aria-hidden':'true'}),document.createTextNode(label),key);
    }back.onclick=undo;forward.onclick=redo;
    const refresh=()=>{back.disabled=!historyState().undo;forward.disabled=!historyState().redo;};document.addEventListener('historychange',refresh);refresh();actions.append(back,forward);panel.append(actions);
  }
  if(!isReadOnly()){
    const clear=document.createElement('button');clear.type='button';clear.append(createElement(Trash2,{width:15,height:15,'aria-hidden':'true'}),document.createTextNode('Clear canvas…'));clear.className='clear-canvas';
    const confirm=document.createElement('div');confirm.className='clear-canvas-confirm';confirm.hidden=true;
    clear.onclick=()=>{const action=clearCanvas();confirm.replaceChildren();const description=document.createElement('p');description.textContent=action.description+' You can undo this.';
      const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=()=>{confirm.hidden=true;clear.focus();};
      const proceed=document.createElement('button');proceed.type='button';proceed.textContent=`Clear ${action.name}`;proceed.className='clear-canvas';proceed.onclick=()=>{action.run();confirm.hidden=true;close();};
      confirm.append(description,cancel,proceed);confirm.hidden=false;cancel.focus();};panel.append(clear,confirm);
  }
  const files=document.createElement('div');files.className='model-file-actions';
  const exportButton=document.createElement('button');exportButton.type='button';exportButton.append(createElement(Download,{width:15,height:15,'aria-hidden':'true'}),document.createTextNode('Export models…'));
  exportButton.onclick=()=>{try{const blob=new Blob([encodeModelFile(snapshot(),business())],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`semantical-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='Models exported.';}catch{status.textContent='Could not export models.';}};files.append(exportButton);
  if(!isReadOnly()){
    const picker=document.createElement('input');picker.type='file';picker.accept='.json,application/json';picker.hidden=true;picker.setAttribute('aria-label','Import model file');
    const importButton=document.createElement('button');importButton.type='button';importButton.append(createElement(Upload,{width:15,height:15,'aria-hidden':'true'}),document.createTextNode('Import models…'));
    const preview=document.createElement('div');preview.className='clear-canvas-confirm';preview.hidden=true;
    importButton.onclick=()=>{picker.value='';preview.hidden=true;picker.click();};
    picker.onchange=async()=>{const file=picker.files?.[0];if(!file)return;status.textContent='';preview.hidden=true;try{
      if(file.size>10*1024*1024)throw Error('Choose a model file smaller than 10 MB.');
      const data=decodeModelFile(await file.text());preview.replaceChildren();const description=document.createElement('p');description.textContent=`Replace both models with ${data.lineage.nodes.length} tables, ${data.semantics.entities.length} entities and ${data.semantics.metrics.length} metrics from ${file.name}? You can undo this.`;
      const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=()=>{preview.hidden=true;importButton.focus();};
      const apply=document.createElement('button');apply.type='button';apply.textContent='Import and replace';apply.onclick=()=>{importModel(data);preview.hidden=true;status.textContent='Models imported. You can undo this.';};preview.append(description,cancel,apply);preview.hidden=false;
    }catch(e){status.textContent=e instanceof Error?`Import failed: ${e.message}`:'Import failed. Choose a valid model file.';}};
    files.append(importButton,picker,preview);
  }
  if(!isReadOnly()){
    const demo=document.createElement('button');demo.type='button';demo.append(createElement(FlaskConical,{width:15,height:15,'aria-hidden':'true'}),document.createTextNode('Load demo…'));
    const preview=document.createElement('div');preview.className='clear-canvas-confirm';preview.hidden=true;
    demo.onclick=()=>{
      preview.replaceChildren();const description=document.createElement('p');description.textContent='Load the Northstar company demo? This replaces both models with example tables, entities, mappings and metrics. You can undo this.';
      const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=()=>{preview.hidden=true;demo.focus();};
      const apply=document.createElement('button');apply.type='button';apply.textContent='Load demo';apply.onclick=()=>{const nodes=companyExample();const semantics=seedBusiness(nodes);arrangeSemantic(semantics);importModel({format:'data-canvas',version:1,lineage:{version:1,canvasWidth:1266,zoom:1,nodes},semantics});preview.hidden=true;close();};
      preview.append(description,cancel,apply);preview.hidden=false;
    };files.append(demo,preview);
  }
  panel.append(files);
  const shareHeading=document.createElement('div');shareHeading.className='share-heading';
  const heading=document.createElement('strong');heading.textContent='Share';
  const info=document.createElement('button');info.type='button';info.className='share-info';info.setAttribute('aria-label','About sharing');info.setAttribute('aria-expanded','false');info.append(createElement(Info,{width:14,height:14,'aria-hidden':'true'}));
  const help=document.createElement('div');help.className='share-help';help.id='share-help';help.hidden=true;info.setAttribute('aria-controls',help.id);
  info.onclick=()=>{help.hidden=!help.hidden;info.setAttribute('aria-expanded',String(!help.hidden));};
  shareHeading.append(heading,info);panel.append(shareHeading);
  for(const mode of ['view','edit'] as const){if(isReadOnly()&&mode==='edit')continue;
    const action=document.createElement('button');action.type='button';action.append(createElement(mode==='view'?Lock:Pencil,{width:15,height:15,'aria-hidden':'true'}),document.createTextNode(mode==='view'?'Copy read-only link':'Copy editable link'));
    action.onclick=async()=>{action.disabled=true;try{const url=await shareURL(snapshot(),business(),mode);output.value=url;output.hidden=true;try{await navigator.clipboard.writeText(url);status.textContent='Link copied.';}catch{output.hidden=false;output.select();status.textContent='Copy the link below.';}}catch(e){status.textContent=e instanceof Error?e.message:'Could not create link.';}finally{action.disabled=false;}};panel.append(action);
  }
  const note=document.createElement('p');note.textContent='Links contain a snapshot of both models. Editable links open an independent copy.';help.append(note);
  if(['localhost','127.0.0.1'].includes(location.hostname)){const local=document.createElement('p');local.textContent='Local preview: links work on this computer. Host the app to share with others.';help.append(local);}
  panel.append(help);
  const output=document.createElement('input');output.readOnly=true;output.hidden=true;output.setAttribute('aria-label','Generated share URL');output.onclick=()=>output.select();
  const status=document.createElement('p');status.role='status';panel.append(output,status);
  const theme=document.createElement('div');theme.className='theme-selector';
  const themeTitle=document.createElement('strong');themeTitle.textContent='Theme';theme.append(themeTitle);
  const choices=document.createElement('div');choices.className='theme-options';choices.setAttribute('role','group');choices.setAttribute('aria-label','Theme');
  for(const [label,icon,value] of [['System',Monitor,'system'],['Light',Sun,'light'],['Dark',Moon,'dark']] as const){
    const choice=document.createElement('button');choice.type='button';choice.dataset.themeChoice=value;
    choice.setAttribute('aria-pressed',String(getThemePreference()===value));
    choice.append(createElement(icon,{width:15,height:15,'aria-hidden':'true'}),document.createTextNode(label));
    choice.onclick=()=>{setThemePreference(value);choices.querySelectorAll<HTMLButtonElement>('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themeChoice===value)));};
    choices.append(choice);
  }
  theme.append(choices);panel.append(theme);nav.append(toggle,panel);
  document.addEventListener('pointerdown',e=>{if(!panel.contains(e.target as Node)&&!toggle.contains(e.target as Node))close();});
  nav.addEventListener('keydown',e=>{if(e.key==='Escape'){close();toggle.focus();}});
  if(isReadOnly()){const badge=document.createElement('span');badge.className='readonly-badge';badge.textContent='Read only';nav.prepend(badge);}
}
// Read-only snapshots retain inspection, navigation and tracing, but no model editing.
export function protectReadOnly() {
  if(!isReadOnly())return;document.body.classList.add('read-only');
  const permitted=(button:HTMLElement)=>button.dataset.readonlyNavigation==='true'||button.id==='close-drawer'||!!button.closest('.business-tabs')||button.classList.contains('node-trace')||button.getAttribute('aria-label')?.startsWith('Trace ')||button.getAttribute('aria-label')?.startsWith('Close ')||button.textContent==='×';
  const apply=()=>{
    document.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('.drawer input,.drawer select,.drawer textarea,.business-drawer input,.business-drawer select,.business-drawer textarea').forEach(el=>{if(el.dataset.readonlyNavigation!=='true')el.disabled=true;});
    document.querySelectorAll<HTMLButtonElement>('.drawer button,.business-drawer button').forEach(b=>{if(!permitted(b))b.disabled=true;});
  };
  const observer=new MutationObserver(apply);observer.observe(document.body,{childList:true,subtree:true});apply();
  document.addEventListener('click',e=>{const b=(e.target as Element).closest('button');if(b&&b.closest('.drawer,.business-drawer')&&!permitted(b)){e.preventDefault();e.stopImmediatePropagation();}},true);
}
