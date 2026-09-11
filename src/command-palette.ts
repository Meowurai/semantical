import {filterPalette} from './palette-search';
import {createElement,Search,Terminal,X,ArrowUpRight} from 'lucide';
import './command-palette.css';
export interface PaletteItem {id:string;label:string;detail:string;keywords?:string;kind?:'table'|'entity'|'metric'|'command';run:()=>void}
export function installCommandPalette(searchItems:()=>PaletteItem[],commands:()=>PaletteItem[]){
  const dialog=document.createElement('dialog');dialog.className='command-palette';dialog.setAttribute('aria-label','Global search');document.body.append(dialog);
  const head=document.createElement('div');head.className='palette-search';
  const symbol=document.createElement('span');const input=document.createElement('input');input.type='text';input.autocomplete='off';input.spellcheck=false;input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','true');input.setAttribute('aria-controls','palette-results');
  const close=document.createElement('button');close.type='button';close.setAttribute('aria-label','Close palette');close.append(createElement(X,{width:16,height:16,'aria-hidden':'true'}));close.onclick=()=>dialog.close();head.append(symbol,input,close);
  const list=document.createElement('div');list.id='palette-results';list.className='palette-results';list.setAttribute('role','listbox');
  const footer=document.createElement('footer');footer.textContent='↑ ↓ Navigate · Enter Open · Esc Close';dialog.append(head,list,footer);
  let mode:'search'|'commands'='search',selected=0,results:PaletteItem[]=[];
  function activate(){const item=results[selected];if(!item)return;dialog.close();document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(open=>open.close());item.run();}
  function render(){
    const matches=filterPalette(mode==='search'?searchItems():commands(),input.value);results=matches.slice(0,100);selected=Math.min(selected,Math.max(0,results.length-1));list.replaceChildren();
    results.forEach((item,index)=>{const row=document.createElement('div');row.id=`palette-option-${index}`;row.className='palette-option';row.dataset.kind=item.kind??'command';row.setAttribute('role','option');row.setAttribute('aria-selected',String(index===selected));
      const text=document.createElement('div'),label=document.createElement('strong'),detail=document.createElement('span');label.textContent=item.label;detail.textContent=item.detail;text.append(label,detail);row.append(text,createElement(ArrowUpRight,{width:14,height:14,'aria-hidden':'true'}));row.onpointerdown=e=>e.preventDefault();row.onclick=()=>{selected=index;activate();};list.append(row);
    });
    if(!results.length){const empty=document.createElement('p');empty.className='palette-empty';empty.textContent=input.value?'No matches. Try another name.':mode==='search'?'No objects yet. Create a table, entity, or metric to start.':'No commands available.';list.append(empty);input.removeAttribute('aria-activedescendant');}else input.setAttribute('aria-activedescendant',`palette-option-${selected}`);
    footer.textContent=`${matches.length} ${mode==='search'?'results':'commands'}${matches.length>100?' · showing first 100':''} · ↑ ↓ Navigate · Enter Open · Esc Close`;
  }
  function updateSelection(){list.querySelectorAll('[role=option]').forEach((row,index)=>row.setAttribute('aria-selected',String(index===selected)));const active=list.children[selected] as HTMLElement|undefined;if(active){input.setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'});}}
  function open(value:'search'|'commands'){
    mode=value;selected=0;input.value='';dialog.setAttribute('aria-label',mode==='search'?'Global search':'Run a command');input.placeholder=mode==='search'?'Search all models…':'Type a command…';input.setAttribute('aria-label',mode==='search'?'Search all models':'Search commands');symbol.replaceChildren(createElement(mode==='search'?Search:Terminal,{width:18,height:18,'aria-hidden':'true'}));render();
    if(!dialog.open)dialog.showModal();input.focus();
  }
  input.oninput=()=>{selected=0;render();};
  dialog.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','Enter','Escape'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();if(e.key==='Escape'){dialog.close();return;}if(e.key==='Enter'){activate();return;}if(results.length){selected=(selected+(e.key==='ArrowDown'?1:-1)+results.length)%results.length;updateSelection();}}});
  document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&!e.altKey&&e.key.toLowerCase()==='p'){e.preventDefault();e.stopImmediatePropagation();open(e.shiftKey?'commands':'search');}},true);
  document.addEventListener('open-palette',e=>open((e as CustomEvent).detail==='commands'?'commands':'search'));
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  return {open};
}
