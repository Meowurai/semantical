import {isReadOnly} from './sharing';

/** Local workspace identity and entry points; model mutations use the existing flows. */
export function installWorkspaceGuidance(isEmpty:()=>boolean,mode:()=>string,key:string){
  const identity=document.createElement('div');identity.className='workspace-identity';
  const name=document.createElement('input');name.setAttribute('aria-label','Workspace name');name.placeholder='Untitled model';name.maxLength=100;name.readOnly=isReadOnly();
  try{name.value=localStorage.getItem(`${key}:name`)??'';}catch{/* Storage failures are surfaced by the model notice. */}
  const status=document.createElement('span');status.className='workspace-save-status';status.setAttribute('role','status');
  name.onchange=()=>{try{localStorage.setItem(`${key}:name`,name.value.trim());}catch{status.textContent='Name could not be saved';}};
  identity.append(name,status);document.body.append(identity);
  const empty=document.createElement('section');empty.className='workspace-empty';empty.setAttribute('aria-label','Get started');empty.hidden=true;
  const title=document.createElement('h1'),description=document.createElement('p'),actions=document.createElement('div');
  for(const [label,action] of [['Load demo','demo'],['Import model','import']]){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>document.dispatchEvent(new CustomEvent('model-menu-action',{detail:action}));actions.append(button);
  }
  empty.append(title,description,actions);document.body.append(empty);
  let queued=false;
  const refresh=()=>{queued=false;empty.hidden=!isEmpty();title.textContent=`Your ${mode().toLowerCase()} starts here`;description.textContent=isReadOnly()?'This shared view has no objects.':'Explore a connected example, import a model, or add your first object using the toolbar.';actions.hidden=isReadOnly();
    const failed=[...document.querySelectorAll<HTMLElement>('.storage-notice,.business-notice')].some(n=>!n.hidden&&!!n.textContent);
    status.textContent=isReadOnly()?'Read-only snapshot':failed?'Local saving needs attention':'Local workspace · autosaves on this device';
  };
  const schedule=()=>{if(!queued){queued=true;queueMicrotask(refresh);}};
  document.addEventListener('canvas-content-change',schedule);document.addEventListener('historychange',schedule);
  for(const notice of document.querySelectorAll('.storage-notice,.business-notice'))new MutationObserver(schedule).observe(notice,{attributes:true,childList:true});
  refresh();
}
