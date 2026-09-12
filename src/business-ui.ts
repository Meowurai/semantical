import {installWorkspaceGuidance} from './workspace-guidance';
import {decorateCanvasControls} from './canvas-controls';
import {installCommandPalette,type PaletteItem} from './command-palette';
import {installHotkeys} from './hotkeys';
import {setThemePreference} from './theme';
import {relationshipManager} from './relationships-ui';
import {placeLabel} from './label-layout';
import {mappingWorkspace} from './mapping-workspace';
import {registerHistory,beginHistory,commitHistory,undo,redo,historyState} from './history';
import {shared,isReadOnly,installShareMenu} from './sharing';
import {nodeMenu} from './node-menu';
import {createElement,Table2,Shapes,ChartNoAxesCombined,ArrowUpRight,Pencil,X,Plus,GitBranch,Network,CircleCheck,Ellipsis} from 'lucide';
import {arrangeSemantic} from './semantic-layout';
import {routeAssociations,roundedPath} from './routing';
import {coverage,decodeBusiness,seedBusiness,metricIssues,type Metric,type BusinessModel,type Entity,type Attribute} from './business-model';
import type {TableNode} from './types';
import './business.css';
export function initBusiness(tables:TableNode[],key:string,example:boolean,physicalSnapshot:()=>string,trace:(tableId:string,columnId:string)=>void) {
  const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
  const button=(text:string,fn:()=>void)=>{const b=el('button',text);b.type='button';b.onclick=fn;return b;};
  const physical=document.querySelector<HTMLElement>('#app')!;
  const root=el('div','','business-app');root.hidden=true;document.body.append(root);
  const stage=el('main','','business-stage');stage.setAttribute('aria-label','Business entity canvas');
  const drawing=el('div','','business-drawing');stage.append(drawing);
  const drawer=el('aside','','business-drawer');drawer.hidden=true;root.append(stage,drawer);
  const nav=el('nav','','model-switch');nav.setAttribute('aria-label','Model menu');document.body.append(nav);
  let activeMetric:Metric|undefined;let active:Entity|undefined;let section='Definition';let zoom=1,panX=0,panY=0;let writable=true;let firstView=true;let freshModel=false;
  let model:BusinessModel={version:1,entities:[],relationships:[],metrics:[]};
  const notice=el('p','','business-notice');root.append(notice);notice.hidden=true;
  try {const raw=(isReadOnly()?null:localStorage.getItem(key))??shared?.business;freshModel=!raw;model=raw?decodeBusiness(raw):example?seedBusiness(tables):model;if(raw&&example&&!Object.hasOwn(JSON.parse(raw),'metrics')){
    const entity=model.entities.find(e=>e.name==='Order Line');const amount=entity?.attributes.find(a=>a.name==='Net amount');
    if(entity&&amount)model.metrics.push({id:crypto.randomUUID(),name:'Net revenue',definition:'Sum of net order-line amounts. Review cancellation and recognition rules before use.',entityId:entity.id,attributeId:amount.id,aggregation:'Sum',timeAttributeId:entity.attributes.find(a=>a.name==='Order date')?.id??'',dimensions:[],filters:'',representationId:entity.representations[0]?.id??'',x:entity.x+440,y:entity.y});
  }}
  catch {writable=false;notice.textContent='Saved business model could not be loaded. Saving is paused to protect it.';notice.hidden=false;}
  const save=()=>{if(isReadOnly()||!writable)return;try{localStorage.setItem(key,JSON.stringify(model));notice.hidden=true;}catch{notice.textContent='Business changes could not be saved locally. Keep this tab open.';notice.hidden=false;}};
  const switchView=(business:boolean)=>{updateToolbar(business);physical.hidden=business;root.hidden=!business;p.setAttribute('aria-pressed',String(!business));b.setAttribute('aria-pressed',String(business));document.dispatchEvent(new Event('canvas-content-change'));if(business){render();if(firstView){firstView=false;requestAnimationFrame(fit);}}};
  const p=button('Lineage',()=>switchView(false)),b=button('Semantics',()=>switchView(true));nav.append(p,b);p.setAttribute('aria-pressed','true');b.setAttribute('aria-pressed','false');installShareMenu(nav,physicalSnapshot,()=>model,()=>root.hidden?{
    name:'Lineage',description:'Remove all tables and lineage connections. Semantic bindings will be reported as missing.',run:()=>document.dispatchEvent(new Event('clear-lineage'))
  }:{name:'Semantics',description:'Remove all entities, metrics, relationships and semantic mappings. Physical tables remain.',run:()=>{beginHistory();model={version:1,entities:[],relationships:[],metrics:[]};active=undefined;activeMetric=undefined;drawer.hidden=true;save();render();commitHistory();}},data=>{beginHistory();document.dispatchEvent(new CustomEvent('import-lineage',{detail:data.lineage}));model=data.semantics;active=undefined;activeMetric=undefined;drawer.hidden=true;search.value='';save();render();fit();commitHistory();});
  const arrange=()=>arrangeSemantic(model);
  const controls=el('div','','business-controls');
  const search=el('input');search.type='search';search.placeholder='Find entity or metric...';search.setAttribute('aria-label','Find entity');search.oninput=()=>draw();
  const checksPanel=el('div','','business-checks-panel');checksPanel.hidden=true;stage.append(checksPanel);
  const checksButton=button('Checks',()=>{checksPanel.hidden=!checksPanel.hidden;refreshChecks();});
  function refreshChecks(){
    checksPanel.replaceChildren();let count=0;
    for(const entity of model.entities){const issues=[...(!entity.name.trim()?['Entity name is required']:[]),...(!entity.grain.trim()?['Grain is undefined']:[]),...(coverage(entity,tables)!=='Mapped'?['Physical mapping is incomplete']:[])];for(const issue of issues){count++;checksPanel.append(button(`${entity.name} — ${issue}`,()=>{checksPanel.hidden=true;section=issue.includes('mapping')?'Mappings':'Definition';open(entity);}));}}
    for(const metric of model.metrics)for(const issue of metricIssues(metric,model,tables)){count++;checksPanel.append(button(`${metric.name} — ${issue}`,()=>{checksPanel.hidden=true;active=undefined;activeMetric=metric;section='Implementation';drawer.hidden=false;render();}));}
    checksButton.classList.toggle('checks-clear',count===0);checksButton.replaceChildren(createElement(CircleCheck,{width:16,height:16,'aria-hidden':'true'}),el('span',`Checks · ${count}`));if(!count)checksPanel.append(el('p','No definition issues found.'));
  }
  const applyView=()=>{stage.classList.toggle('overview-mode',zoom<.6);drawing.style.transform=`translate(${panX}px,${panY}px) scale(${zoom})`;zoomLabel.textContent=`${Math.round(zoom*100)}%`;};
  const zoomLabel=button('100%',()=>{zoom=1;applyView();});zoomLabel.setAttribute('aria-label','Reset business zoom');
  const bounds=()=>[...model.entities.map(e=>({ ...e,height:48+Math.min(252,16+e.attributes.length*32)})),...model.metrics.map(m=>({...m,height:170}))];
  const fit=()=>{
    const items=bounds();if(!items.length||!stage.clientWidth)return;
    const left=Math.min(...items.map(e=>e.x)),top=Math.min(...items.map(e=>e.y));
    const w=Math.max(...items.map(e=>e.x+270))-left,h=Math.max(...items.map(e=>e.y+e.height))-top;
    const availableW=Math.max(80,stage.clientWidth-100),availableH=Math.max(80,stage.clientHeight-150);
    zoom=Math.min(1,availableW/w,availableH/h);
    panX=76+(availableW-w*zoom)/2-left*zoom;panY=44+(availableH-h*zoom)/2-top*zoom;applyView();
  };
  function focusSelection(){
    const selected=activeMetric??active;if(!selected||drawer.hidden)return;
    const h=bounds().find(e=>e.id===selected.id)?.height??170;
    zoom=Math.min(Math.max(zoom,.85),Math.max(.2,(stage.clientWidth-100)/270),Math.max(.2,(stage.clientHeight-150)/h));
    panX=76+(stage.clientWidth-100-270*zoom)/2-selected.x*zoom;
    panY=44+(stage.clientHeight-150-h*zoom)/2-selected.y*zoom;applyView();
  }

  const viewControls=el('div','','business-view-controls');viewControls.setAttribute('role','group');viewControls.setAttribute('aria-label','Canvas view');
  controls.append(search,checksButton);
  viewControls.append(button('−',()=>{zoom=Math.max(.25,zoom/1.2);applyView();}),zoomLabel,button('+',()=>{zoom=Math.min(2,zoom*1.2);applyView();}),button('Fit',fit),button('Arrange',()=>{beginHistory();arrange();draw();fit();save();commitHistory();}));decorateCanvasControls(viewControls);stage.append(controls,viewControls);
  const createMetric=()=>{
    switchView(true);active=undefined;section='Definition';
    const metric:Metric={id:crypto.randomUUID(),name:'New metric',definition:'',entityId:'',attributeId:'',aggregation:'Sum',timeAttributeId:'',dimensions:[],filters:'',representationId:'',x:(stage.clientWidth/2-panX)/zoom-135,y:(stage.clientHeight/2-panY)/zoom};
    model.metrics.push(metric);activeMetric=metric;drawer.hidden=false;render();save();
  };
  const createEntity=()=>{
    switchView(true);section='Definition';
    const entity:Entity={id:crypto.randomUUID(),name:'New entity',definition:'',grain:'',rules:'',x:(stage.clientWidth/2-panX)/zoom-135,y:(stage.clientHeight/2-panY)/zoom,attributes:[],representations:[]};
    model.entities.push(entity);open(entity);save();
  };
  const toolbar=physical.querySelector<HTMLElement>('.toolbar')!;
  toolbar.classList.add('workspace-toolbar');toolbar.setAttribute('aria-label','Model tools');document.body.append(toolbar);
  const chooser=el('div','','toolbar-view-switch');chooser.setAttribute('role','group');chooser.setAttribute('aria-label','Model views');chooser.append(p,b);toolbar.prepend(chooser);
  const tools=el('div','','toolbar-create-tools');toolbar.append(tools);
  const tableButton=toolbar.querySelector<HTMLButtonElement>('#add-table')!;tools.append(tableButton);
  const entityButton=button('Entity',createEntity);entityButton.setAttribute('aria-label','Create entity');
  const metricButton=button('Metric',createMetric);metricButton.setAttribute('aria-label','Create metric');tools.append(entityButton,metricButton);
  for(const [action,label,icon] of [[tableButton,'Add table',Table2],[entityButton,'Add entity',Shapes],[metricButton,'Add metric',ChartNoAxesCombined]] as const){action.title=label;action.replaceChildren(createElement(icon,{'aria-hidden':'true',width:16,height:16,'stroke-width':1.5}),el('span',label));}
  const relations=relationshipManager(tables,()=>model,()=>{document.dispatchEvent(new Event('lineage-relationships-changed'));save();render();},isReadOnly);
  const relationsButton=button('Relationships',()=>relations.open(root.hidden?'lineage':'semantics'));toolbar.append(relationsButton);
  const physicalChecks=document.querySelector<HTMLButtonElement>('#validation-button')!;
  const physicalChecksPanel=document.querySelector<HTMLElement>('#validation-list')!;
  toolbar.append(physicalChecks,checksButton);
  for(const panel of [physicalChecksPanel,checksPanel]){panel.classList.add('toolbar-checks-panel');document.body.append(panel);}
  document.addEventListener('pointerdown',event=>{const target=event.target as Node;for(const [button,panel] of [[physicalChecks,physicalChecksPanel],[checksButton,checksPanel]] as const){if(!button.contains(target)&&!panel.contains(target))panel.hidden=true;}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){physicalChecksPanel.hidden=true;checksPanel.hidden=true;}});
  function updateToolbar(semantic:boolean){
    physicalChecks.hidden=semantic;checksButton.hidden=!semantic;physicalChecksPanel.hidden=true;checksPanel.hidden=true;
    tableButton.hidden=semantic;entityButton.hidden=!semantic;metricButton.hidden=!semantic;
    relationsButton.replaceChildren(createElement(semantic?Network:GitBranch,{width:16,height:16,'aria-hidden':'true'}),el('span','Relationships'));
    relationsButton.setAttribute('aria-label',semantic?'Manage entity relationships':'Manage lineage relationships');
    resizeToolbar();
  }
  const overflow=el('div','','toolbar-overflow');overflow.hidden=true;overflow.setAttribute('role','group');overflow.setAttribute('aria-label','More model tools');document.body.append(overflow);
  const more=button('',()=>{overflow.hidden=!overflow.hidden;more.setAttribute('aria-expanded',String(!overflow.hidden));if(!overflow.hidden)overflow.querySelector<HTMLButtonElement>('button:not([hidden])')?.focus();});
  more.append(createElement(Ellipsis,{width:18,height:18,'aria-hidden':'true'}));more.setAttribute('aria-label','More model tools');more.setAttribute('aria-expanded','false');toolbar.append(more);
  overflow.addEventListener('click',event=>{if((event.target as Element).closest('button')){overflow.hidden=true;more.setAttribute('aria-expanded','false');}});
  const modeSelect=el('select');modeSelect.setAttribute('aria-label','Model view');modeSelect.add(new Option('Lineage','lineage'));modeSelect.add(new Option('Semantics','semantics'));modeSelect.onchange=()=>switchView(modeSelect.value==='semantics');toolbar.prepend(modeSelect);
  const secondary=[relationsButton,physicalChecks,checksButton];
  function resizeToolbar(){
    if(!more)return;
    // Measure the remaining canvas directly: CSS custom widths can contain min().
    const area=root.hidden?physical.querySelector('main')?.clientWidth??window.innerWidth:stage.clientWidth;
    const compact=area-96<690,narrow=area<420;
    modeSelect.hidden=!narrow;modeSelect.value=root.hidden?'lineage':'semantics';chooser.hidden=narrow;toolbar.classList.toggle('narrow',narrow);
    for(const action of [tableButton,entityButton,metricButton]){if(!isReadOnly())(narrow?overflow:tools).append(action);}

    for(const action of secondary)(compact?overflow:toolbar).append(action);
    more.hidden=!compact;toolbar.classList.toggle('compact',compact);
    if(!compact){overflow.hidden=true;more.setAttribute('aria-expanded','false');}
    toolbar.style.width='max-content';
    overflow.style.left=`${Math.max(12,Math.min(area-260,toolbar.getBoundingClientRect().left))}px`;
  }
  new ResizeObserver(resizeToolbar).observe(stage);
  new ResizeObserver(resizeToolbar).observe(physical.querySelector('main')!);
  document.addEventListener('pointerdown',event=>{if(!overflow.contains(event.target as Node)&&!more.contains(event.target as Node)){overflow.hidden=true;more.setAttribute('aria-expanded','false');}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!overflow.hidden){overflow.hidden=true;more.setAttribute('aria-expanded','false');more.focus();}});
  updateToolbar(false);
  installWorkspaceGuidance(()=>root.hidden?tables.length===0:model.entities.length+model.metrics.length===0,()=>root.hidden?'Lineage':'Semantics',key);
  const field=(label:string,value:string,change:(value:string)=>void,multiline=false)=>{const wrapper=el('label',label);const input=multiline?el('textarea'):el('input');input.value=value;if(input instanceof HTMLTextAreaElement)input.rows=2;input.setAttribute('aria-label',label);input.oninput=()=>{change(input.value);save();draw();};wrapper.append(input);return wrapper;};
  const select=(label:string,value:string,options:[string,string][],change:(value:string)=>void)=>{const input=el('select');input.setAttribute('aria-label',label);options.forEach(([v,t])=>input.add(new Option(t,v)));input.value=value;input.onchange=()=>{change(input.value);save();render();};return input;};
  const check=(label:string,value:boolean,change:(value:boolean)=>void)=>{const l=el('label',label,'business-check');const i=el('input');i.type='checkbox';i.checked=value;i.onchange=()=>{change(i.checked);save();draw();};l.prepend(i);return l;};
  const open=(entity:Entity)=>{activeMetric=undefined;active=entity;drawer.hidden=false;render();requestAnimationFrame(focusSelection);};
  let restoringView=false;
  let semanticReturn:(()=>void)|undefined;
  const captureSemantic=()=>{
    const saved={entity:active?.id,metric:activeMetric?.id,section,zoom,panX,panY,hidden:drawer.hidden,scroll:drawer.scrollTop};
    return ()=>{restoringView=true;switchView(true);active=model.entities.find(e=>e.id===saved.entity);activeMetric=model.metrics.find(m=>m.id===saved.metric);section=saved.section;drawer.hidden=saved.hidden;zoom=saved.zoom;panX=saved.panX;panY=saved.panY;render();drawer.scrollTop=saved.scroll;
      setTimeout(()=>{panX=saved.panX;panY=saved.panY;previousWidth=stage.clientWidth;applyView();restoringView=false;},500);};
  };
  const returnButton=button('← Back to Semantics',()=>{semanticReturn?.();returnButton.hidden=true;});returnButton.className='trace-return';returnButton.hidden=true;physical.querySelector('.canvas-controls-left')!.append(returnButton);
  function goTrace(tableId:string,columnId:string){semanticReturn=captureSemantic();switchView(false);trace(tableId,columnId);returnButton.hidden=false;}
  const physicalReturn=button('← Back to Lineage',()=>{});physicalReturn.hidden=true;controls.append(physicalReturn);
  document.addEventListener('semantic-usage',event=>{const detail=(event as CustomEvent).detail;physicalReturn.hidden=false;physicalReturn.onclick=()=>{switchView(false);detail.restore?.();physicalReturn.hidden=true;};switchView(true);if(detail.metricId){active=undefined;activeMetric=model.metrics.find(m=>m.id===detail.metricId);section='Implementation';}else{activeMetric=undefined;active=model.entities.find(e=>e.id===detail.entityId);section='Mappings';}drawer.hidden=false;render();});
  document.addEventListener('request-semantic-usage',event=>{const {tableId,columnId,container,restore}=(event as CustomEvent).detail;
    for(const entity of model.entities)for(const rep of entity.representations.filter(r=>r.tableId===tableId))for(const attribute of entity.attributes.filter(a=>rep.bindings[a.id]===columnId)){
      const link=button(`${entity.name} · ${attribute.name} — ${rep.name}`,()=>document.dispatchEvent(new CustomEvent('semantic-usage',{detail:{entityId:entity.id,restore}})));link.dataset.readonlyNavigation='true';container.append(link);
      for(const metric of model.metrics.filter(m=>m.entityId===entity.id&&m.representationId===rep.id&&[m.attributeId,m.timeAttributeId,...m.dimensions].includes(attribute.id))){const metricLink=button(`${metric.name} — metric dependency`,()=>document.dispatchEvent(new CustomEvent('semantic-usage',{detail:{metricId:metric.id,restore}})));metricLink.dataset.readonlyNavigation='true';container.append(metricLink);}
    }
  });
  let traceMenu:HTMLElement|undefined;
  const closeTraceMenu=()=>{traceMenu?.remove();traceMenu=undefined;};
  document.addEventListener('pointerdown',event=>{if(traceMenu&&!traceMenu.contains(event.target as Node))closeTraceMenu();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeTraceMenu();});
  function nodeTrace(label:string,bindings:{name:string;tableId:string;columnId:string}[]) {
    const valid=bindings.filter(ref=>tables.some(t=>t.id===ref.tableId&&t.columns.some(c=>c.id===ref.columnId)));
    const go=(ref:typeof valid[number])=>{closeTraceMenu();goTrace(ref.tableId,ref.columnId);};
    const action=button('Trace',()=>{
      if(valid.length===1){go(valid[0]);return;}
      closeTraceMenu();
      const menu=el('div','','node-trace-menu');menu.setAttribute('role','group');menu.setAttribute('aria-label',`Choose mapping for ${label}`);
      menu.append(el('p','Choose physical representation'));
      for(const ref of valid)menu.append(button(ref.name,()=>go(ref)));
      const rect=action.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(rect.left,window.innerWidth-292))}px`;menu.style.top=`${Math.max(8,Math.min(rect.bottom+6,window.innerHeight-180))}px`;
      document.body.append(menu);traceMenu=menu;menu.querySelector('button')?.focus({preventScroll:true});
    });
    action.replaceChildren(createElement(ArrowUpRight,{width:14,height:14,'aria-hidden':'true','stroke-width':1.5}));action.className='node-trace';action.setAttribute('aria-label',`Trace ${label}`);action.disabled=!valid.length;action.title=valid.length?'Trace physical lineage':'No physical binding available';
    return action;
  }
  function draw() {
    closeTraceMenu();
    refreshChecks();
    document.dispatchEvent(new Event('canvas-content-change'));
    drawing.replaceChildren();
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('business-links');drawing.append(svg);
    const routes=routeAssociations([...model.entities.map(e=>({id:e.id,x:e.x,y:e.y,width:270,height:48+Math.min(252,16+e.attributes.length*32)})),...model.metrics.map(m=>({id:m.id,x:m.x,y:m.y,width:270,height:162}))],[...model.relationships.map(r=>({source:r.from,target:r.to})),...model.metrics.map(m=>({source:m.entityId,target:m.id}))]);
    const labelObstacles=[...model.entities.map(e=>({id:e.id,x:e.x,y:e.y,width:270,height:48+Math.min(252,16+e.attributes.length*32)})),...model.metrics.map(m=>({id:m.id,x:m.x,y:m.y,width:270,height:162}))];
    for(const r of model.relationships) {
      const from=model.entities.find(e=>e.id===r.from),to=model.entities.find(e=>e.id===r.to);if(!from||!to)continue;
      const routed=routes.find(edge=>edge.source===r.from&&edge.target===r.to);if(!routed)continue;
      routed.points=dragPoints(routed.points);
      const labelText=`${r.name} · ${{'One to one':'1:1','One to many':'1:N','Many to one':'N:1','Many to many':'N:N'}[r.cardinality]??r.cardinality}`;
      const placement=placeLabel(routed.points,Math.min(260,labelText.length*6+24),30,labelObstacles);
      if(!placement)continue;labelObstacles.push(placement.box);
      const line=document.createElementNS(svg.namespaceURI,'path');line.setAttribute('d',roundedPath(routed.points));line.setAttribute('data-relationship',r.id);line.setAttribute('data-label-segment',String(placement.index));line.setAttribute('data-label-t',String(placement.t));line.setAttribute('data-from',from.id);line.setAttribute('data-to',to.id);line.setAttribute('data-points',JSON.stringify(routed.points));svg.append(line);
      const label=button(labelText,()=>{section='Relationships';open(from);});label.className='business-link-label';label.dataset.relationship=r.id;label.style.left=`${placement.x}px`;label.style.top=`${placement.y}px`;drawing.append(label);
    }
    for(const entity of model.entities) {
      const card=el('article','','business-node');card.dataset.summary=`${entity.attributes.length} ${entity.attributes.length===1?'attribute':'attributes'}`;card.style.left=`${entity.x}px`;card.style.top=`${entity.y}px`;card.classList.toggle('selected',active===entity);card.style.opacity=search.value&&!entity.name.toLowerCase().includes(search.value.toLowerCase())?'.18':'1';
      const header=button('',()=>{section='Definition';open(entity);});header.className='business-node-header';
      header.append(createElement(Shapes,{width:16,height:16,'stroke-width':1.5,'aria-hidden':'true'}),el('span',entity.name||'Unnamed entity','entity-name'));
      installDrag(header,card,entity);
      const status=el('span','','entity-status');status.title=coverage(entity,tables);status.setAttribute('aria-label',coverage(entity,tables));status.classList.toggle('incomplete',coverage(entity,tables)!=='Mapped');header.append(status);card.append(header);
      const attributes=el('div','','entity-attributes');attributes.setAttribute('aria-label',`Attributes of ${entity.name}`);
      for(const attribute of entity.attributes){
        const wrapper=el('div','','business-attribute-row');
        const row=button('',()=>{section='Mappings';open(entity);drawer.querySelector<HTMLElement>(`[data-attribute="${attribute.id}"]`)?.focus();});row.className='business-attribute';
        const name=el('span',attribute.name||'Unnamed attribute','entity-attribute-name');name.title=attribute.definition||attribute.name;
        const badges=el('span','','entity-attribute-flags');
        if(attribute.identifier){const badge=el('span','ID','entity-id-badge');badge.title='Business identifier';badges.append(badge);}
        if(attribute.required&&!attribute.identifier){const required=el('span','*','entity-required');required.title='Required';required.setAttribute('aria-label','Required');badges.append(required);}
        row.append(name,badges,el('small',attribute.type.toLowerCase()));
        wrapper.append(row,nodeTrace(`${entity.name}.${attribute.name}`,entity.representations.map(r=>({name:r.name+' · '+r.purpose,tableId:r.tableId,columnId:r.bindings[attribute.id]}))));attributes.append(wrapper);
      }
      if(!entity.attributes.length)attributes.append(el('p','No attributes yet','business-muted'));
      attributes.addEventListener('wheel',event=>{if(attributes.scrollHeight>attributes.clientHeight&&Math.abs(event.deltaY)>=Math.abs(event.deltaX)&&!event.ctrlKey)event.stopPropagation();});
      card.append(attributes);
      card.tabIndex=0;
      nodeMenu(card,{
        edit:()=>{section='Definition';open(entity);},
        pin:{label:entity.pinned?'Unpin position':'Pin position',action:()=>{entity.pinned=!entity.pinned;save();draw();}},
        duplicate:()=>{
          const copy=structuredClone(entity);copy.id=crypto.randomUUID();copy.name=`${entity.name || 'Entity'} copy`;copy.x+=36;copy.y+=36;
          const ids=new Map(copy.attributes.map(a=>[a.id,crypto.randomUUID()]));for(const a of copy.attributes)a.id=ids.get(a.id)!;
          for(const rep of copy.representations){rep.id=crypto.randomUUID();rep.bindings=Object.fromEntries(Object.entries(rep.bindings).map(([id,value])=>[ids.get(id)??id,value]));}
          model.entities.push(copy);section='Definition';open(copy);save();
        },
        delete:()=>{if(!confirm(`Delete ${entity.name} and its relationships? Metrics that use it will be flagged in Checks.`))return;model.entities=model.entities.filter(e=>e!==entity);model.relationships=model.relationships.filter(r=>r.from!==entity.id&&r.to!==entity.id);if(active===entity){active=undefined;drawer.hidden=true;}save();render();}
      });
      drawing.append(card);
    }
    drawMetrics(routes);
    applyView();
  }
  function drawMetrics(routes:ReturnType<typeof routeAssociations>) {
    for(const metric of model.metrics){
      const entity=model.entities.find(e=>e.id===metric.entityId);
      const attribute=entity?.attributes.find(a=>a.id===metric.attributeId);
      const card=el('article','','business-node metric-node');card.style.left=`${metric.x}px`;card.style.top=`${metric.y}px`;card.classList.toggle('selected',activeMetric===metric);
      card.style.opacity=search.value&&!metric.name.toLowerCase().includes(search.value.toLowerCase())?'.18':'1';
      const openMetric=()=>{active=undefined;activeMetric=metric;section='Definition';drawer.hidden=false;render();requestAnimationFrame(focusSelection);};
      const header=button('',openMetric);header.className='business-node-header';
      const issues=metricIssues(metric,model,tables);
      const status=el('span','','metric-status');status.classList.toggle('incomplete',!!issues.length);status.title=issues.length?'Incomplete metric':'Metric is fully bound';
      header.append(createElement(ChartNoAxesCombined,{width:16,height:16,'aria-hidden':'true','stroke-width':1.5}),el('span',metric.name||'Unnamed metric','metric-name'),status);
      installDrag(header,card,metric);
      const body=el('div','','metric-body');
      const content=button('',openMetric);content.className='metric-calculation';
      content.append(el('span',metric.aggregation,'metric-aggregation'),el('span',attribute?.name??'Choose attribute','metric-value'));
      const wrapper=el('div','','business-attribute-row metric-calculation-row');
      const representation=entity?.representations.find(r=>r.id===metric.representationId);
      wrapper.append(content,nodeTrace(metric.name,representation?[{name:representation.name,tableId:representation.tableId,columnId:representation.bindings[metric.attributeId]}]:[]));
      const details=el('dl','','metric-context');
      const time=entity?.attributes.find(a=>a.id===metric.timeAttributeId);
      for(const [label,value] of [['Entity',entity?.name??'Not selected'],['Time',time?.name??'No time basis']]) {
        const term=el('dt',label);const detail=el('dd',value);detail.title=value;details.append(term,detail);
      }
      body.append(wrapper,details);card.append(header,body);drawing.append(card);
      card.tabIndex=0;
      nodeMenu(card,{
        edit:openMetric,
        pin:{label:metric.pinned?'Unpin position':'Pin position',action:()=>{metric.pinned=!metric.pinned;save();draw();}},
        duplicate:()=>{const copy=structuredClone(metric);copy.id=crypto.randomUUID();copy.name=`${metric.name || 'Metric'} copy`;copy.x+=36;copy.y+=36;model.metrics.push(copy);active=undefined;activeMetric=copy;section='Definition';drawer.hidden=false;save();render();},
        delete:()=>{if(!confirm(`Delete ${metric.name}?`))return;model.metrics=model.metrics.filter(m=>m!==metric);if(activeMetric===metric){activeMetric=undefined;drawer.hidden=true;}save();render();}
      });
      const metricRoute=routes.find(r=>r.source===entity?.id&&r.target===metric.id);
      if(entity&&metricRoute){const svg=drawing.querySelector('svg')!;const line=document.createElementNS(svg.namespaceURI,'path');const pts=dragPoints(metricRoute.points);line.setAttribute('d',roundedPath(pts));line.setAttribute('data-from',entity.id);line.setAttribute('data-to',metric.id);line.setAttribute('data-points',JSON.stringify(pts));line.setAttribute('stroke-dasharray','6 4');svg.append(line);}
    }
  }
  function renderMetric(metric:Metric) {
    const header=el('header','Metric properties');const close=button('×',()=>{activeMetric=undefined;drawer.hidden=true;draw();});close.setAttribute('aria-label','Close metric properties');header.append(close);drawer.append(header);
    const tabs=el('div','','business-tabs');for(const name of ['Definition','Implementation']){const tab=button(name,()=>{section=name;render();});tab.setAttribute('aria-pressed',String(section===name));tabs.append(tab);}drawer.append(tabs);
    const entity=model.entities.find(e=>e.id===metric.entityId);
    const attribute=entity?.attributes.find(a=>a.id===metric.attributeId);
    const rep=entity?.representations.find(r=>r.id===metric.representationId);
    if(section==='Definition') {
      drawer.append(field('Metric name',metric.name,v=>metric.name=v),field('Business definition',metric.definition,v=>metric.definition=v,true));
      const entityLabel=el('label','Business entity');entityLabel.append(select('Metric entity',metric.entityId,[['','Choose entity...'],...model.entities.map(e=>[e.id,e.name] as [string,string])],v=>{metric.entityId=v;metric.attributeId='';metric.timeAttributeId='';metric.dimensions=[];metric.representationId='';}));drawer.append(entityLabel);
      const valueLabel=el('label','Value attribute');valueLabel.append(select('Value attribute',metric.attributeId,[['','Choose attribute...'],...(entity?.attributes??[]).map(a=>[a.id,a.name] as [string,string])],v=>metric.attributeId=v));drawer.append(valueLabel);
      const aggregation=el('label','Aggregation');aggregation.append(select('Aggregation',metric.aggregation,['Sum','Average','Count','Distinct count','Minimum','Maximum'].map(v=>[v,v]),v=>metric.aggregation=v as Metric['aggregation']));drawer.append(aggregation);
      const time=el('label','Time basis');time.append(select('Time basis',metric.timeAttributeId,[['','No time basis'],...(entity?.attributes??[]).filter(a=>a.type==='Date').map(a=>[a.id,a.name] as [string,string])],v=>metric.timeAttributeId=v));drawer.append(time);
      const dimensions=el('details','','drawer-disclosure');const dimensionTitle=el('summary',`Dimensions · ${metric.dimensions.length}`);dimensions.append(dimensionTitle);const options=el('div','','dimension-options');
      for(const a of entity?.attributes??[])options.append(check(a.name,metric.dimensions.includes(a.id),v=>{metric.dimensions=v?[...metric.dimensions,a.id]:metric.dimensions.filter(id=>id!==a.id);dimensionTitle.textContent=`Dimensions · ${metric.dimensions.length}`;}));
      if(!entity?.attributes.length)options.append(el('p','Select an entity to choose dimensions.','business-muted'));dimensions.append(options);drawer.append(dimensions);
      const filters=el('details','','drawer-disclosure');filters.open=!!metric.filters;filters.append(el('summary','Business filters'),field('Filter definition',metric.filters,v=>metric.filters=v,true),el('p','Describe business intent; filters are not executable SQL.','business-muted'));drawer.append(filters);
    } else {
      const label=el('label','Physical representation');label.append(select('Metric representation',metric.representationId,[['','Choose representation...'],...(entity?.representations??[]).map(r=>[r.id,`${r.name} · ${r.purpose}`] as [string,string])],v=>metric.representationId=v));drawer.append(label);
      const grid=el('table','','business-mapping-table');const h=grid.createTHead().insertRow();for(const title of ['Business attribute','Physical binding','']){const th=el('th',title);h.append(th);}const body=grid.createTBody();
      for(const id of [...new Set([metric.attributeId,metric.timeAttributeId,...metric.dimensions].filter(Boolean))]) {
        const a=entity?.attributes.find(a=>a.id===id),table=tables.find(t=>t.id===rep?.tableId),column=table?.columns.find(c=>c.id===rep?.bindings[id]);const row=body.insertRow();row.insertCell().textContent=a?.name??'Missing attribute';row.insertCell().textContent=column&&table?`${table.name}.${column.name}`:'Unmapped';const traceButton=button('Trace',()=>{if(table&&column){goTrace(table.id,column.id);}});traceButton.disabled=!column;row.insertCell().append(traceButton);
      }drawer.append(grid);
      drawer.append(el('p',`${metric.aggregation} of ${entity?.name??'entity'}.${attribute?.name??'attribute'}. Physical bindings are inherited from the entity representation.`, 'business-muted'));
    }
    const issues=metricIssues(metric,model,tables);for(const issue of issues)drawer.append(el('p',issue,'business-issue'));
    drawer.append(button('Delete metric',()=>{if(!confirm(`Delete ${metric.name}?`))return;model.metrics=model.metrics.filter(m=>m!==metric);activeMetric=undefined;drawer.hidden=true;save();render();}));
  }
  function dragPoints(raw:{x:number;y:number}[]) {
    const points=raw.filter((p,i)=>!i||i===raw.length-1||!((raw[i-1].x===p.x&&p.x===raw[i+1].x)||(raw[i-1].y===p.y&&p.y===raw[i+1].y))).map(p=>({...p}));
    if(points.length===2){const [a,b]=points;points.splice(1,0,...(a.x===b.x?[{x:a.x,y:(a.y+b.y)/2},{x:b.x,y:(a.y+b.y)/2}]:[{x:(a.x+b.x)/2,y:a.y},{x:(a.x+b.x)/2,y:b.y}]));}
    return points;
  }
  function installDrag(header:HTMLButtonElement,card:HTMLElement,item:{id:string;x:number;y:number}) {
    let start:{x:number;y:number;left:number;top:number}|undefined;
    header.onpointerdown=e=>{if(e.button!==0||isReadOnly())return;start={x:e.clientX,y:e.clientY,left:item.x,top:item.y};header.setPointerCapture(e.pointerId);};
    header.onpointermove=e=>{if(!start)return;item.x=start.left+(e.clientX-start.x)/zoom;item.y=start.top+(e.clientY-start.y)/zoom;card.style.left=`${item.x}px`;card.style.top=`${item.y}px`;
      const dx=item.x-start.left,dy=item.y-start.top;
      for(const path of drawing.querySelectorAll<SVGPathElement>('[data-points]')) {
        const raw=JSON.parse(path.dataset.points!) as {x:number;y:number}[];
        const points=dragPoints(raw);
        if(path.dataset.from===item.id){const vertical=points[0].x===points[1].x;points[0].x+=dx;points[0].y+=dy;if(vertical)points[1].x+=dx;else points[1].y+=dy;}
        if(path.dataset.to===item.id){const vertical=points.at(-1)!.x===points.at(-2)!.x;points.at(-1)!.x+=dx;points.at(-1)!.y+=dy;if(vertical)points.at(-2)!.x+=dx;else points.at(-2)!.y+=dy;}
        path.setAttribute('d',roundedPath(points));
        if(path.dataset.relationship){
          const label=[...drawing.querySelectorAll<HTMLElement>('.business-link-label')].find(label=>label.dataset.relationship===path.dataset.relationship);
          const index=Number(path.dataset.labelSegment),a=points[index],b=points[index+1];
          if(label&&a&&b){const t=Number(path.dataset.labelT??.5);label.style.left=`${a.x+(b.x-a.x)*t}px`;label.style.top=`${a.y+(b.y-a.y)*t}px`;}
        }
      }
    };
    header.onpointerup=e=>{if(!start)return;const moved=Math.hypot(e.clientX-start.x,e.clientY-start.y)>4;start=undefined;if(moved){header.onclick=null;save();draw();}};
    header.onpointercancel=()=>{start=undefined;save();draw();};
  }
  function render() {
    renderContents();
    drawer.classList.toggle('metric-properties',!!activeMetric);
    const header=drawer.querySelector('header');
    if(header){const caption=header.firstChild;if(caption?.nodeType===Node.TEXT_NODE){const label=el('span',caption.textContent??'','drawer-title');label.prepend(createElement(activeMetric?ChartNoAxesCombined:Shapes,{width:16,height:16,'aria-hidden':'true','stroke-width':1.5}));caption.replaceWith(label);}const close=header.querySelector('button');close?.replaceChildren(createElement(X,{width:16,height:16,'aria-hidden':'true'}));}
    const labels=[...drawer.querySelectorAll<HTMLLabelElement>(':scope > label')];
    if(activeMetric&&section==='Definition'){
      const calculation=el('section','','drawer-field-grid');calculation.append(el('h3','Calculation'));
      for(const label of labels.slice(2))calculation.append(label);
      if(labels[1])labels[1].after(calculation);
    }
    const attributes=[...drawer.querySelectorAll('h3')].find(h=>h.textContent==='Attributes');
    if(attributes&&attributes.nextElementSibling?.tagName==='BUTTON'){const add=attributes.nextElementSibling;const heading=el('div','','drawer-section-heading');attributes.before(heading);heading.append(attributes,add);add.replaceChildren(createElement(Plus,{width:14,height:14,'aria-hidden':'true'}),document.createTextNode('Attribute'));}
    for(const button of drawer.querySelectorAll<HTMLButtonElement>(':scope > button'))if(button.textContent?.startsWith('Delete'))button.classList.add('drawer-delete');
    for(const area of drawer.querySelectorAll('.business-representation'))for(const select of area.querySelectorAll<HTMLSelectElement>(':scope > select')){const label=el('label',select.getAttribute('aria-label')??'');select.before(label);label.append(select);}
  }
  function renderContents() {
    drawer.classList.toggle('mapping-open',!!active&&!activeMetric&&section==='Mappings');
    draw();drawer.replaceChildren();if(activeMetric){renderMetric(activeMetric);return;}if(!active)return;
    const entity=active;
    const header=el('header','Entity properties');const close=button('×',()=>{active=undefined;drawer.hidden=true;draw();});close.setAttribute('aria-label','Close entity properties');header.append(close);drawer.append(header);
    const tabs=el('div','','business-tabs');for(const tab of ['Definition','Mappings','Relationships']){const btn=button(tab,()=>{section=tab;render();});btn.setAttribute('aria-pressed',String(section===tab));tabs.append(btn);}drawer.append(tabs);
    if(section==='Definition') {
      drawer.append(field('Entity name',entity.name,v=>entity.name=v),field('Definition',entity.definition,v=>entity.definition=v,true),field('Grain',entity.grain,v=>entity.grain=v));
      const rules=el('details','','drawer-disclosure');rules.open=!!entity.rules;rules.append(el('summary','Business rules'),field('Rules',entity.rules,v=>entity.rules=v,true));drawer.append(rules);
      drawer.append(el('h3','Attributes'),button('+ Attribute',()=>{entity.attributes.push({id:crypto.randomUUID(),name:'New attribute',definition:'',type:'Text',required:false,identifier:false});save();render();}));
      const attributeTable=el('table','','business-mapping-table attribute-grid');
      const ah=attributeTable.createTHead().insertRow();for(const title of ['Attribute','Type','Flags','']){const th=el('th',title);th.scope='col';ah.append(th);}const ab=attributeTable.createTBody();
      for(const a of entity.attributes){
        const row=ab.insertRow();const input=el('input');input.value=a.name;input.placeholder='Attribute name...';input.setAttribute('aria-label',`Attribute name ${a.name}`);input.oninput=()=>{a.name=input.value;save();draw();};row.insertCell().append(input);
        row.insertCell().append(select(`Type of ${a.name}`,a.type,['Text','Number','Boolean','Date'].map(v=>[v,v]),v=>a.type=v as Attribute['type']));
        const flags=row.insertCell();flags.className='attribute-flags';const required=check('Req',a.required,v=>a.required=v);required.title='Required';required.querySelector('input')!.setAttribute('aria-label','Required');flags.append(check('ID',a.identifier,v=>a.identifier=v),required);
        const remove=button('×',()=>{entity.attributes=entity.attributes.filter(x=>x!==a);entity.representations.forEach(r=>delete r.bindings[a.id]);save();render();});remove.className='business-remove';remove.setAttribute('aria-label',`Remove ${a.name}`);row.insertCell().append(remove);
        const detailRow=ab.insertRow();detailRow.className='attribute-definition-row';detailRow.hidden=true;const cell=detailRow.insertCell();cell.colSpan=4;cell.append(field('Attribute definition',a.definition,v=>a.definition=v,true));
        const edit=button('',()=>{detailRow.hidden=!detailRow.hidden;edit.setAttribute('aria-expanded',String(!detailRow.hidden));});edit.className='attribute-note';edit.setAttribute('aria-label',`Edit definition of ${a.name}`);edit.setAttribute('aria-expanded','false');edit.title=a.definition||'Add definition';edit.append(createElement(Pencil,{width:14,height:14,'aria-hidden':'true'}));remove.before(edit);
      }
      drawer.append(attributeTable);
      drawer.append(button('Delete entity',()=>{if(!confirm(`Delete ${entity.name} and its mappings and relationships?`))return;model.entities=model.entities.filter(e=>e!==entity);model.relationships=model.relationships.filter(r=>r.from!==entity.id&&r.to!==entity.id);active=undefined;drawer.hidden=true;save();render();}));
    } else if(section==='Mappings') {
      drawer.append(mappingWorkspace(entity,tables,()=>{save();draw();},(table,column)=>goTrace(table,column)));
    } else {
      drawer.append(el('p','Business relationships describe meaning and cardinality. They do not create physical joins.','business-muted'),button('+ Relationship',()=>{const other=model.entities.find(e=>e!==entity);if(!other)return;model.relationships.push({id:crypto.randomUUID(),from:entity.id,to:other.id,name:'relates to',cardinality:'One to many',optional:true});save();render();}));
      for(const relation of model.relationships.filter(r=>r.from===entity.id||r.to===entity.id)){const area=el('section','','business-representation');area.append(select('From entity',relation.from,model.entities.map(e=>[e.id,e.name]),v=>relation.from=v),field('Relationship name',relation.name,v=>relation.name=v),select('To entity',relation.to,model.entities.map(e=>[e.id,e.name]),v=>relation.to=v),select('Cardinality',relation.cardinality,['One to one','One to many','Many to one','Many to many'].map(v=>[v,v]),v=>relation.cardinality=v),check('Optional relationship',relation.optional,v=>relation.optional=v),button('Remove relationship',()=>{model.relationships=model.relationships.filter(r=>r!==relation);save();render();}));drawer.append(area);}
    }
  }
  let pan:{x:number;y:number;px:number;py:number}|undefined;
  stage.onpointerdown=e=>{if((e.target as Element).closest('button,input,select,.business-node'))return;pan={x:e.clientX,y:e.clientY,px:panX,py:panY};stage.setPointerCapture(e.pointerId);stage.classList.add('panning');};
  stage.onpointermove=e=>{if(pan){panX=pan.px+e.clientX-pan.x;panY=pan.py+e.clientY-pan.y;applyView();}};
  stage.onpointerup=e=>{if(pan&&Math.hypot(e.clientX-pan.x,e.clientY-pan.y)<4){active=undefined;activeMetric=undefined;drawer.hidden=true;draw();}pan=undefined;stage.classList.remove('panning');};
  stage.onpointercancel=()=>{pan=undefined;stage.classList.remove('panning');};
  stage.addEventListener('wheel',e=>{if((e.target as Element).closest('.business-controls, .business-view-controls'))return;e.preventDefault();if(e.ctrlKey){const rect=stage.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;const next=Math.max(.25,Math.min(2,zoom*Math.exp(-e.deltaY*.01)));panX=x-(x-panX)*next/zoom;panY=y-(y-panY)*next/zoom;zoom=next;}else{panX-=e.deltaX;panY-=e.deltaY;}applyView();},{passive:false});
  document.addEventListener('keydown',e=>{if(!root.hidden&&e.key==='Escape'){active=undefined;activeMetric=undefined;drawer.hidden=true;draw();}});
  let previousWidth=0;
  new ResizeObserver(()=>{if(root.hidden||restoringView)return;const width=stage.clientWidth;if(activeMetric||active)focusSelection();else if(previousWidth)panX+=(width-previousWidth)/2;previousWidth=width;applyView();}).observe(stage);
  if(writable){if(freshModel)arrange();save();}
  const focusEntity=(entity:Entity,attributeId?:string)=>{switchView(true);section='Definition';open(entity);requestAnimationFrame(()=>{panX=(stage.clientWidth-270*zoom)/2-entity.x*zoom;panY=Math.max(32,(stage.clientHeight-250*zoom)/2)-entity.y*zoom;applyView();if(attributeId){const attr=entity.attributes.find(a=>a.id===attributeId);[...drawer.querySelectorAll<HTMLInputElement>('input')].find(input=>input.value===attr?.name)?.focus();}});};
  const focusMetric=(metric:Metric)=>{switchView(true);active=undefined;activeMetric=metric;section='Definition';drawer.hidden=false;render();requestAnimationFrame(()=>{panX=(stage.clientWidth-270*zoom)/2-metric.x*zoom;panY=(stage.clientHeight-170*zoom)/2-metric.y*zoom;applyView();});};
  const searchItems=():PaletteItem[]=>[
    ...tables.flatMap(table=>{const qualified=[table.database,table.schema,table.name].filter(Boolean).join('.');return [
      {id:`table:${table.id}`,label:table.name||'Untitled table',detail:`Table · ${qualified}`,kind:'table' as const,run:()=>{switchView(false);document.dispatchEvent(new CustomEvent('navigate-lineage-table',{detail:table.id}));}},
      ...table.columns.map(column=>({id:`column:${table.id}:${column.id}`,label:column.name,detail:`Column · ${qualified}`,keywords:column.type,kind:'table' as const,run:()=>{switchView(false);trace(table.id,column.id);}}))];}),
    ...model.entities.flatMap(entity=>[{id:`entity:${entity.id}`,label:entity.name||'Untitled entity',detail:'Entity · Semantics',kind:'entity' as const,run:()=>focusEntity(entity)},...entity.attributes.map(attribute=>({id:`attribute:${entity.id}:${attribute.id}`,label:attribute.name,detail:`Attribute · ${entity.name}`,kind:'entity' as const,run:()=>focusEntity(entity,attribute.id)}))]),
    ...model.metrics.map(metric=>({id:`metric:${metric.id}`,label:metric.name||'Untitled metric',detail:`Metric · ${model.entities.find(entity=>entity.id===metric.entityId)?.name||'Unbound'}`,kind:'metric' as const,run:()=>focusMetric(metric)}))
  ];
  const menuAction=(label:string)=>{const action=[...nav.querySelectorAll<HTMLButtonElement>('.share-menu button')].find(button=>button.textContent===label);if(!action)return;const menu=nav.querySelector<HTMLElement>('.share-menu')!;menu.hidden=false;nav.querySelector('[aria-expanded]')?.setAttribute('aria-expanded','true');action.click();};
  const commands=():PaletteItem[]=>{
    const item=(id:string,label:string,detail:string,run:()=>void):PaletteItem=>({id,label,detail,kind:'command',run});
    return [
      item('search','Search all models','⌘P · Tables, columns, entities, attributes and metrics',()=>document.dispatchEvent(new CustomEvent('open-palette',{detail:'search'}))),
      item('commands','Open command palette','⌘⇧P · Run an action',()=>document.dispatchEvent(new CustomEvent('open-palette',{detail:'commands'}))),
      item('hotkeys','Keyboard shortcuts','? · Show the hotkey map',()=>document.dispatchEvent(new Event('open-hotkeys'))),
      item('lineage','Switch to Lineage','1 · View tables and data flow',()=>switchView(false)),
      item('semantics','Switch to Semantics','2 · View entities and metrics',()=>switchView(true)),
      item('fit','Fit canvas','F · Frame the current model',()=>{if(root.hidden)document.dispatchEvent(new Event('fit-lineage'));else fit();}),
      item('relations','Manage relationships','R · List and edit relationships for this mode',()=>relations.open(root.hidden?'lineage':'semantics')),
      item('checks','Show checks','C · Review model issues',()=>{if(root.hidden)document.querySelector<HTMLButtonElement>('#validation-button')?.click();else checksButton.click();}),
      item('export','Export models','Save both models as JSON',()=>menuAction('Export models…')),
      ...(['system','light','dark'] as const).map(theme=>item(`theme-${theme}`,`Theme: ${theme[0].toUpperCase()+theme.slice(1)}`,'Change appearance',()=>{setThemePreference(theme);nav.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themeChoice===theme)));})),
      ...(!isReadOnly()?[
        item('table','Create table','T · Add a table to Lineage',()=>{switchView(false);tableButton.click();}),
        item('entity','Create entity','E · Add a business entity',()=>entityButton.click()),
        item('metric','Create metric','M · Add a metric',()=>metricButton.click()),
        item('arrange','Arrange canvas','A · Organize the current model',()=>{if(root.hidden)document.dispatchEvent(new Event('arrange-lineage'));else{beginHistory();arrange();draw();fit();save();commitHistory();}}),
        item('import','Import models','Load models from a JSON file',()=>menuAction('Import models…')),
        item('demo','Load demo','Load the Northstar company example',()=>menuAction('Load demo…')),
        item('clear','Clear canvas','Clear the current mode after confirmation',()=>menuAction('Clear canvas…')),
        ...(historyState().undo?[item('undo','Undo','⌘Z · Undo the last change',undo)]:[]),
        ...(historyState().redo?[item('redo','Redo','⌘⇧Z · Redo the last change',redo)]:[])
      ]:[])
    ];
  };
  installCommandPalette(searchItems,commands);
  installHotkeys(commands,[{key:'1',label:'Switch to Lineage',command:'lineage'},{key:'2',label:'Switch to Semantics',command:'semantics'},{key:'t',label:'Create table',command:'table'},{key:'e',label:'Create entity',command:'entity'},{key:'m',label:'Create metric',command:'metric'},{key:'f',label:'Fit canvas',command:'fit'},{key:'a',label:'Arrange canvas',command:'arrange'},{key:'r',label:'Manage relationships',command:'relations'},{key:'c',label:'Show checks',command:'checks'},{key:'?',label:'Keyboard shortcuts',command:'hotkeys'}]);
  registerHistory('business',{read:()=>model,write:value=>{model=value;active=undefined;activeMetric=undefined;drawer.hidden=true;save();render();}});
}
