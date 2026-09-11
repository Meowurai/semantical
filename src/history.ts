type Adapter={read:()=>unknown;write:(value:any)=>void};
const adapters=new Map<string,Adapter>();
let undoStack:string[]=[],redoStack:string[]=[],before:string|undefined,typing=false,restoring=false,positions=false;
const snapshot=()=>JSON.stringify(Object.fromEntries([...adapters].map(([key,a])=>[key,a.read()])));
export function registerHistory(key:string,adapter:Adapter){adapters.set(key,adapter);}
export function recordPositionChange(){positions=true;}
export function beginHistory(){if(!restoring&&!before)before=snapshot();}
const notify=()=>{if(typeof document!=='undefined')document.dispatchEvent(new Event('historychange'));};
const signature=(raw:string)=>{const value=JSON.parse(raw);if(value.physical?.length){const {x,y}=value.physical[0];value.physical=value.physical.map((n:any)=>({...n,x:Math.round((n.x-x)*100)/100,y:Math.round((n.y-y)*100)/100}));}return JSON.stringify(value);};
export function commitHistory(){if(!before||restoring)return;const after=snapshot();if((positions?before:signature(before))!==(positions?after:signature(after))){undoStack.push(before);if(undoStack.length>100)undoStack.shift();redoStack=[];}before=undefined;positions=false;notify();}
export function undo(){commitHistory();const target=undoStack.pop();if(!target)return;redoStack.push(snapshot());restore(target);}
export function redo(){commitHistory();const target=redoStack.pop();if(!target)return;undoStack.push(snapshot());restore(target);}
function restore(raw:string){restoring=true;try{for(const [key,value] of Object.entries(JSON.parse(raw)))adapters.get(key)?.write(value);}finally{restoring=false;}notify();}
export const historyState=()=>({undo:undoStack.length>0,redo:redoStack.length>0});
export function installHistory(){
 const editable=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('.drawer input,.drawer textarea,.business-drawer input,.business-drawer textarea');
 document.addEventListener('focusin',e=>{if(editable(e.target)){beginHistory();typing=true;}},true);
 document.addEventListener('focusout',()=>{if(typing){typing=false;commitHistory();}},true);
 document.addEventListener('pointerdown',e=>{if((e.target as Element).closest('.table-node,.business-node'))beginHistory();},true);
 document.addEventListener('pointerup',()=>setTimeout(()=>{if(!typing)commitHistory();}));
 document.addEventListener('click',e=>{const b=(e.target as Element).closest('button');if(!b||b.closest('.model-switch,.canvas-controls-right,.business-view-controls'))return;beginHistory();setTimeout(()=>{if(!typing)commitHistory();});},true);
 document.addEventListener('change',()=>{beginHistory();setTimeout(commitHistory);},true);
 document.addEventListener('keydown',e=>{if(!(e.metaKey||e.ctrlKey)||e.key.toLowerCase()!=='z')return;if((e.target as Element).closest('input,textarea,[contenteditable=true]'))return;e.preventDefault();e.shiftKey?redo():undo();});
}
