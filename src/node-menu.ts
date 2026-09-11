import {isReadOnly} from './sharing';
import {createElement,Pencil,Copy,Trash2,Pin} from 'lucide';
import './node-menu.css';
type Actions={edit:()=>void;duplicate:()=>void;delete:()=>void;pin?:{label:string;action:()=>void}};
let closeActive:(()=>void)|undefined;
export function nodeMenu(node:Element,actions:Actions) {
  if(isReadOnly())return;
  function open(x:number,y:number){
    closeActive?.();
    const previous=document.activeElement as HTMLElement|null;
    const menu=document.createElement('div');menu.className='node-context-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Node actions');
    const close=()=>{menu.remove();document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',keyboard,true);window.removeEventListener('blur',close);closeActive=undefined;};
    const outside=(event:Event)=>{if(!menu.contains(event.target as Node))close();};
    const keyboard=(event:KeyboardEvent)=>{
      const items=[...menu.querySelectorAll('button')];const index=items.indexOf(document.activeElement as HTMLButtonElement);
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowUp'?-1:1)+items.length)%items.length].focus();}
      if(event.key==='Escape'||event.key==='Tab'){event.preventDefault();event.stopPropagation();close();previous?.focus({preventScroll:true});}
    };
    for(const [label,icon,action] of [['Edit',Pencil,actions.edit],['Duplicate',Copy,actions.duplicate],['Delete',Trash2,actions.delete]] as const){
      const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitem');if(label==='Delete')button.className='danger';
      button.append(createElement(icon,{width:15,height:15,'aria-hidden':'true','stroke-width':1.5}),document.createTextNode(label));
      button.onclick=()=>{close();action();};menu.append(button);
    }
    if(actions.pin){const pin=document.createElement('button');pin.type='button';pin.setAttribute('role','menuitem');pin.append(createElement(Pin,{width:15,height:15,'aria-hidden':'true'}),document.createTextNode(actions.pin.label));pin.onclick=()=>{close();actions.pin!.action();};menu.append(pin);}
    document.body.append(menu);menu.style.left=`${Math.max(8,Math.min(x,innerWidth-menu.offsetWidth-8))}px`;menu.style.top=`${Math.max(8,Math.min(y,innerHeight-menu.offsetHeight-8))}px`;
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',keyboard,true);window.addEventListener('blur',close);closeActive=close;
    menu.querySelector('button')!.focus({preventScroll:true});
  }
  node.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();const e=event as MouseEvent;open(e.clientX,e.clientY);});
  node.addEventListener('keydown',event=>{const e=event as KeyboardEvent;if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();e.stopPropagation();const r=node.getBoundingClientRect();open(r.left+16,r.top+40);}});
}
