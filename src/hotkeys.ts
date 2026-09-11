import type {PaletteItem} from './command-palette';
export interface Shortcut {key:string;label:string;command:string}
export function installHotkeys(commands:()=>PaletteItem[],shortcuts:Shortcut[]){
  const dialog=document.createElement('dialog');dialog.className='relationships-dialog hotkey-dialog';document.body.append(dialog);
  const mod=/Mac|iPhone|iPad/.test(navigator.platform)?'⌘':'Ctrl';
  function open(){
    dialog.replaceChildren();const header=document.createElement('header'),title=document.createElement('h2');title.id='hotkey-title';title.textContent='Keyboard shortcuts';dialog.setAttribute('aria-labelledby',title.id);const close=document.createElement('button');close.type='button';close.textContent='Close';close.onclick=()=>dialog.close();header.append(title,close);dialog.append(header);
    const list=document.createElement('dl');list.className='hotkey-list';
    for(const [label,key] of [['Global search',`${mod} P`],['Command palette',`${mod} Shift P`],['Undo',`${mod} Z`],['Redo',`${mod} Shift Z`],...shortcuts.map(s=>[s.label,s.key.toUpperCase()]),['Navigate palette','↑ / ↓'],['Run selected result','Enter'],['Close palette or dialog','Esc']]){const name=document.createElement('dt'),value=document.createElement('dd'),kbd=document.createElement('kbd');name.textContent=label;kbd.textContent=key;value.append(kbd);list.append(name,value);}dialog.append(list);
    const note=document.createElement('p');note.className='hotkey-note';note.textContent='Single-key shortcuts work on the canvas, outside text fields and dialogs. Editing commands are unavailable in read-only models.';dialog.append(note);if(!dialog.open)dialog.showModal();
  }
  document.addEventListener('keydown',e=>{if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey||document.querySelector('dialog[open]')||(e.target instanceof Element&&e.target.closest('input,textarea,select,[contenteditable=true]')))return;const shortcut=shortcuts.find(s=>s.key===e.key.toLowerCase());if(!shortcut)return;const command=commands().find(c=>c.id===shortcut.command);if(command){e.preventDefault();command.run();}});
  document.addEventListener('open-hotkeys',open);
  return {open};
}
