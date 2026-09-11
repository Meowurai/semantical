import {decorateCanvasControls} from './canvas-controls';
import './palette.css';
import {registerHistory,installHistory,recordPositionChange,beginHistory,commitHistory} from './history';
import {shared,isReadOnly} from './sharing';
import {nodeMenu} from './node-menu';
import { initBusiness } from "./business-ui";

import { routeEdges, roundedPath, lineCrossings, type Point, type RoutedEdge } from './routing';
import { companyExample, upgradeCompanyExample } from './company-example';
import { downstreamColumns, validateModel, layoutTables } from './model-tools';
import './style.css';
import { createElement, createIcons, Table2, Plus, X, Trash2, GripVertical, Pencil, CircleCheck } from 'lucide';
import { DATA_TYPES, type Column, type TableNode, formatType } from './types';
import { STORAGE_KEY, decodeSnapshot, encodeSnapshot } from './persistence';
import { canAddSource, columnRefKey, columnInputs, upstreamColumns } from './lineage';
import { autocomplete } from './autocomplete';

const app = document.querySelector<HTMLDivElement>('#app')!;
const canvas = document.querySelector<SVGSVGElement>('#canvas')!;
const drawer = document.querySelector<HTMLElement>('.drawer')!;
const nameInput = document.querySelector<HTMLInputElement>('#table-name')!;
const logicInput = document.querySelector<HTMLTextAreaElement>('#table-logic')!;
const schemaInput = document.querySelector<HTMLInputElement>('#table-schema')!;
const databaseInput = document.querySelector<HTMLInputElement>('#table-database')!;
const columnList = document.querySelector<HTMLDivElement>('#column-list')!;
const addButton = document.querySelector<HTMLButtonElement>('#add-table')!;
const sourceSelect = document.querySelector<HTMLSelectElement>('#source-table')!;
const sourceList = document.querySelector<HTMLTableSectionElement>('#source-list')!;
const tableLabel = (node: TableNode) => [node.database, node.schema, node.name || 'Untitled table'].filter(Boolean).join('.');
const ns = 'http://www.w3.org/2000/svg';
const isCompanyExample = new URLSearchParams(location.search).get('example') === 'company';
const modelStorageKey = shared ? `${STORAGE_KEY}:shared:${shared.id}:${shared.mode}` : isCompanyExample ? `${STORAGE_KEY}:northstar-example` : STORAGE_KEY;
let freshExample = false;
const nodes: TableNode[] = [];
const storageNotice = document.createElement('p');
storageNotice.className = 'storage-notice';
storageNotice.role = 'status';
storageNotice.hidden = true;
document.querySelector('.workspace')!.append(storageNotice);
let storageReadable = true;
let initialZoom = 1;
let lastSaved = '';
let saveTimer: ReturnType<typeof setTimeout> | undefined;
try {
  const raw = (isReadOnly()?null:localStorage.getItem(modelStorageKey)) ?? shared?.physical;
  if (raw) {
    const snapshot = decodeSnapshot(raw);
    initialZoom = snapshot.zoom ?? 1;
    const shift = (canvas.clientWidth / initialZoom - snapshot.canvasWidth) / 2;
    nodes.push(...snapshot.nodes.map(node => ({ ...node, x: node.x + shift })));
  }
  if (raw && isCompanyExample) upgradeCompanyExample(nodes);
  if (!raw && isCompanyExample) { nodes.push(...companyExample()); freshExample = true; }
} catch {
  storageReadable = false;
  storageNotice.textContent = 'Saved canvas could not be loaded. Local saving is paused to protect it.';
  storageNotice.hidden = false;
}
function saveCanvas() {
  clearTimeout(saveTimer);
  if (isReadOnly() || !storageReadable || canvas.clientWidth <= 0) return;
  const snapshot = encodeSnapshot(nodes, sceneWidth(), zoom);
  if (snapshot === lastSaved) return;
  try {
    localStorage.setItem(modelStorageKey, snapshot);
    lastSaved = snapshot;
    storageNotice.hidden = true;
  } catch {
    storageNotice.textContent = 'Changes could not be saved locally. Keep this tab open.';
    storageNotice.hidden = false;
  }
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveCanvas, 150); }
window.addEventListener('pagehide', saveCanvas);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveCanvas(); });
const width = 280;
const headerHeight = 48;
const maxNodeHeight = 300;
const columnBodyHeight = (node: TableNode) => Math.min(maxNodeHeight, headerHeight + (node.columns.length ? Math.max(1, visibleColumns(node).length) * 32 + 16 : 0));
const nodeHeight = (node: TableNode) => columnBodyHeight(node);
const columnScroll = new Map<string, number>();
let selected: string | null = null;
let expandedColumn: string | null = null;
let columnEditor: 'keys' | 'logic' = 'logic';
let columnFilter: { tableId: string; columnId: string } | null = null;
let showDependencies = false;
let traceDirection: 'upstream' | 'downstream' = 'upstream';
let zoom = initialZoom;
const sceneWidth = () => canvas.clientWidth / zoom;
const sceneHeight = () => canvas.clientHeight / zoom;
let routeCacheKey = '';
let routeCache: RoutedEdge[] = [];
let navigationFrame = 0;
function stopNavigation() {
  cancelAnimationFrame(navigationFrame);
  navigationFrame = 0;
  scheduleSave();
}
function navigateToTable(id: string) {
  const target = nodes.find(node => node.id === id);
  if (!target) return;
  select(id);
  drawer.querySelector('.drawer-content')!.scrollTop = 0;
  const dx = (sceneWidth() - width) / 2 - target.x;
  const dy = Math.max(16, (sceneHeight() - nodeHeight(target)) / 2) - target.y;
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 480;
  const start = performance.now();
  let previous = 0;
  const step = (now: number) => {
    const progress = duration ? Math.min(1, (now - start) / duration) : 1;
    const eased = progress * progress * (3 - 2 * progress);
    for (const node of nodes) {
      node.x += dx * (eased - previous);
      node.y += dy * (eased - previous);
      canvas.querySelector(`[data-id="${node.id}"]`)?.setAttribute('transform', `translate(${node.x}, ${node.y})`);
    }
    translateConnections(dx * (eased - previous), dy * (eased - previous));
    previous = eased;
    if (progress < 1) navigationFrame = requestAnimationFrame(step);
    else {
      navigationFrame = 0;
      canvas.querySelector<SVGGElement>(`[data-id="${id}"]`)?.focus({ preventScroll: true });
      scheduleSave();
    }
  };
  navigationFrame = requestAnimationFrame(step);
}
function filteredColumnContext() {
  const tables = new Set<string>();
  if (!columnFilter) return { tables, columns: new Set<string>() };
  const linked = traceDirection === 'upstream' ? upstreamColumns(nodes, columnFilter.tableId, columnFilter.columnId, showDependencies) : downstreamColumns(nodes, columnFilter.tableId, columnFilter.columnId, showDependencies);
  linked.add(columnRefKey(columnFilter.tableId, columnFilter.columnId));
  tables.add(columnFilter.tableId);
  for (const key of linked) { const [id] = JSON.parse(key); if (id !== columnFilter.tableId) tables.add(id); }
  return { tables, columns: linked };
}
function visibleColumns(node: TableNode): Column[] {
  const context = filteredColumnContext();
  return context.tables.has(node.id) ? node.columns.filter(column => context.columns.has(columnRefKey(node.id, column.id))) : node.columns;
}
const mappingLabels = { source: 'Source', alias: 'Alias', derived: 'Derived', external: 'External source' };
let viewportWidth = sceneWidth();
let pan: { pointerId: number; startX: number; startY: number; lastX: number; lastY: number; moved: boolean } | null = null;
const dragRoutes = new Map<string, {points: {x:number;y:number}[]; source:{x:number;y:number}; target:{x:number;y:number}}>();
let drag: { node: TableNode; startX: number; startY: number; x: number; y: number; moved: boolean } | null = null;
const icons = () => createIcons({ icons: { Table2, Plus, X, Trash2, GripVertical, Pencil, CircleCheck }, attrs: { width: '16', height: '16', 'stroke-width': '1.5', 'aria-hidden': 'true' } });
icons();

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

let previousClickState = '';
function render() {
  renderTraceDrawer();
  const clickState = JSON.stringify([selected, columnFilter, traceDirection, showDependencies]);
  const animateClick = previousClickState !== '' && previousClickState !== clickState && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  previousClickState = clickState;
  const oldNodes = new Map([...canvas.querySelectorAll<SVGGElement>('.table-node')].map(group => [group.dataset.id!, {
    opacity: getComputedStyle(group).opacity,
    height: group.querySelector('rect')?.getAttribute('height'),
    stroke: group.querySelector('rect') ? getComputedStyle(group.querySelector('rect')!).stroke : '',
  }]));
  const oldRows = new Map([...canvas.querySelectorAll<HTMLElement>('.node-column')].map(row => [row.dataset.columnRef!, getComputedStyle(row).opacity]));
  scheduleSave();
  canvas.setAttribute('viewBox', `0 0 ${sceneWidth()} ${sceneHeight()}`);
  refreshValidation();
  const filterContext = filteredColumnContext();
  canvas.classList.toggle('tracing', columnFilter !== null);
  document.querySelectorAll<HTMLButtonElement>('[data-trace-control]').forEach(button => {
    button.hidden = !columnFilter;
    button.setAttribute('aria-pressed', String(button.dataset.traceControl === 'impact' ? traceDirection === 'downstream' : showDependencies));
  });
  const legend = document.querySelector<HTMLElement>('#trace-legend'); if (legend) legend.hidden = !columnFilter;
  const focusedId = document.activeElement?.getAttribute('data-id');
  canvas.replaceChildren();
  const defs = svg('defs', {});
  const marker = svg('marker', { id: 'lineage-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
  marker.append(svg('path', { d: 'M 1 1 L 9 5 L 1 9', fill: 'none', stroke: 'var(--text-163)', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  defs.append(marker);
  canvas.append(defs, svg('g', { id: 'lineage-edges', 'pointer-events': 'none' }));
  renderEdges();
  for (const node of nodes) {
    const qualifiedName = tableLabel(node);
    const group = svg('g', { transform: `translate(${node.x}, ${node.y})`, class: `table-node${node.id === selected ? ' selected' : ''}`, tabindex: '0', role: 'button', 'aria-label': `Open ${qualifiedName}`, 'data-id': node.id });
    group.classList.toggle('trace-muted', !!columnFilter && node.id !== columnFilter.tableId && !filterContext.tables.has(node.id));
    group.append(svg('rect', { width: String(width), height: String(nodeHeight(node)), rx: '10' }));
    const header = svg('foreignObject', { x: '1', y: '1', width: String(width - 2), height: String(headerHeight - 1) });
    const headerContent = document.createElement('div'); headerContent.className = 'node-header';
    const title = document.createElement('span');
    title.className = 'node-heading';
    title.textContent = qualifiedName;
    headerContent.append(createElement(Table2,{width:16,height:16,'stroke-width':1.5,'aria-hidden':'true'}),title); header.append(headerContent); group.append(header);
    if (node.columns.length) {
      group.append(svg('line', { x1: '0', y1: String(headerHeight), x2: String(width), y2: String(headerHeight), stroke: 'var(--border-54)', 'pointer-events': 'none' }));
      const body = svg('foreignObject', { x: '1', y: String(headerHeight + 1), width: String(width - 2), height: String(columnBodyHeight(node) - headerHeight - 2) });
      const scroller = document.createElement('div');
      scroller.className = 'node-columns';
      const columnFrame=document.createElement('div');columnFrame.className='node-column-frame';
      columnFrame.classList.toggle('scrollable',headerHeight+visibleColumns(node).length*32+16>maxNodeHeight);
      const updateFade=()=>columnFrame.classList.toggle('more-below',scroller.scrollHeight-scroller.clientHeight-scroller.scrollTop>2);
      scroller.tabIndex = 0;
      scroller.setAttribute('role', 'region');
      scroller.setAttribute('aria-label', `Columns of ${qualifiedName}`);
      for (const column of visibleColumns(node)) {
        const row = document.createElement('div'); row.className = `node-column mapping-${column.mapping?.kind ?? 'unset'}`;
        row.dataset.columnRef = columnRefKey(node.id, column.id);
        row.classList.toggle('linked-column', filterContext.columns.has(row.dataset.columnRef) || (columnFilter?.tableId === node.id && columnFilter.columnId === column.id));
        row.tabIndex = 0; row.setAttribute('role', 'button');
        row.setAttribute('aria-pressed', String(columnFilter?.tableId === node.id && columnFilter.columnId === column.id));
        row.setAttribute('aria-label', `${column.name || 'Column'}${column.primaryKey ? ', primary key' : ''}${column.foreignKey ? ', foreign key' : ''}${column.businessKey ? ', business key' : ''}`);
        const dot = document.createElement('span'); dot.className = 'mapping-dot'; dot.setAttribute('aria-label', column.mapping ? mappingLabels[column.mapping.kind] : 'Unspecified');
        const name = document.createElement('span'); name.className = 'node-column-name'; name.textContent = column.name || 'Column';
        const type = document.createElement('span'); type.className = 'node-column-type'; type.textContent = formatType(column).toLowerCase();
        row.append(dot, name);
        const keys = document.createElement('span'); keys.className = 'column-keys';
        for (const [enabled, label, description] of [[column.primaryKey, 'PK', 'Primary key'], [column.foreignKey, 'FK', 'Foreign key'], [column.businessKey, 'BK', 'Business key']] as const) {
          if (!enabled) continue;
          const badge = document.createElement('span'); badge.className = 'column-key'; badge.textContent = label; badge.setAttribute('aria-label', description); keys.append(badge);
        }
        row.append(keys);
        row.append(type); scroller.append(row);
        const activate = () => {
          const same = columnFilter?.tableId === node.id && columnFilter.columnId === column.id;
          columnFilter = !same ? { tableId: node.id, columnId: column.id } : null;
          selected = null; drawer.inert = true; app.classList.remove('drawer-open');
          namespacePickers.forEach(picker => picker.close());
          render();
          canvas.querySelector<HTMLElement>(`[data-column-ref='${columnRefKey(node.id, column.id)}']`)?.focus({ preventScroll: true });
        };
        row.addEventListener('click', event => { event.stopPropagation(); activate(); });
        row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); activate(); } });
      }
      if (!visibleColumns(node).length && filterContext.tables.has(node.id)) {
        const empty = document.createElement('div'); empty.className = 'no-linked-columns'; empty.textContent = 'No linked columns'; scroller.append(empty);
      }
      scroller.addEventListener('scroll', () => { updateFade();columnScroll.set(node.id, scroller.scrollTop); renderColumnEdges(); });
      scroller.addEventListener('pointerdown', event => event.stopPropagation());
      scroller.addEventListener('keydown', event => { if (event.key !== 'Escape') event.stopPropagation(); });
      scroller.addEventListener('click', () => { if (selected !== node.id) select(node.id); });
      columnFrame.append(scroller);body.append(columnFrame);group.append(body);
    }
    nodeMenu(group, {
      edit:()=>select(node.id),
      duplicate:()=>{
        const copy=structuredClone(node);copy.id=crypto.randomUUID();copy.name=`${node.name || 'Table'} copy`;copy.x+=36;copy.y+=36;
        const ids=new Map(copy.columns.map(c=>[c.id,crypto.randomUUID()]));
        for(const c of copy.columns){c.id=ids.get(c.id)!;for(const ref of c.mapping?.sources??[])if(ref.tableId===node.id){ref.tableId=copy.id;ref.columnId=ids.get(ref.columnId)??ref.columnId;}}
        for(const ref of copy.ruleDependencies??[])if(ref.tableId===node.id){ref.tableId=copy.id;ref.columnId=ids.get(ref.columnId)??ref.columnId;}
        copy.upstream=copy.upstream.map(id=>id===node.id?copy.id:id);nodes.push(copy);select(copy.id);
      },
      delete:()=>{
        if(!confirm(`Delete ${tableLabel(node)}? Existing bindings to this table will be reported as missing.`))return;
        nodes.splice(nodes.indexOf(node),1);for(const target of nodes)target.upstream=target.upstream.filter(id=>id!==node.id);
        select(null);
      }
    });
    group.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if(isReadOnly()){select(node.id);return;}
      drag = { node, startX: event.clientX, startY: event.clientY, x: node.x, y: node.y, moved: false };
      canvas.setPointerCapture(event.pointerId);
    });
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(node.id); nameInput.focus(); }
    });
    canvas.append(group);
    for (const text of headerContent.querySelectorAll<HTMLElement>('.node-heading')) {
      if (text.scrollWidth > text.clientWidth) text.title = text.textContent ?? '';
    }
    const scroller = group.querySelector<HTMLElement>('.node-columns');
    if (scroller) {
      scroller.scrollTop = filterContext.tables.has(node.id) ? 0 : columnScroll.get(node.id) ?? 0;
      scroller.parentElement!.classList.toggle('more-below',scroller.scrollHeight-scroller.clientHeight-scroller.scrollTop>2);
    }
    if (node.id === focusedId) group.focus({ preventScroll: true });
  }
  icons();
  renderColumnEdges();
  if (animateClick) {
    const timing = {duration: 450, easing: 'cubic-bezier(.25,.1,.25,1)'};
    for (const group of canvas.querySelectorAll<SVGGElement>('.table-node')) {
      const before = oldNodes.get(group.dataset.id!);
      if (!before) continue;
      group.animate([{opacity: before.opacity}, {opacity: getComputedStyle(group).opacity}], timing);
      const rect = group.querySelector('rect')!;
      rect.animate([{height: `${before.height}px`, stroke: before.stroke}, {height: `${rect.getAttribute('height')}px`, stroke: getComputedStyle(rect).stroke}], timing);
    }
    for (const row of canvas.querySelectorAll<HTMLElement>('.node-column')) {
      row.animate([{opacity: oldRows.get(row.dataset.columnRef!) ?? '0'}, {opacity: getComputedStyle(row).opacity}], timing);
    }
    canvas.querySelector('.column-details')?.animate([{opacity: 0, transform: 'translateY(4px)'}, {opacity: 1, transform: 'translateY(0)'}], timing);
    canvas.querySelector('#column-edges')?.animate([{opacity: 0}, {opacity: 1}], timing);
  }
}

function select(id: string | null) {
  stopNavigation();
  columnFilter = null;
  namespacePickers.forEach(picker => picker.close());
  selected = id;
  app.classList.toggle('drawer-open', id !== null);
  drawer.inert = id === null;
  const node = nodes.find((item) => item.id === id);
  if (node) {
    nameInput.value = node.name;
    logicInput.value = node.logic;
    document.querySelector<HTMLElement>('.transformation')!.hidden = false;
    renderTransformation(node);
    schemaInput.value = node.schema;
    databaseInput.value = node.database;
    renderColumns(node);
    renderLineage(node);
  }
  render();
}

addButton.addEventListener('click', () => {
  if (columnFilter) select(null);
  const offset = (nodes.length % 5) * 28;
  nodes.push({ id: crypto.randomUUID(), name: `Table ${nodes.length + 1}`, database: '', schema: '', logic: '', columns: [], upstream: [], x: Math.max(16, (sceneWidth() - width) / 2 + offset), y: Math.max(16, (sceneHeight() - 64) / 2 + offset) });
  const current = nodes.find(node => node.id === selected);
  if (current) renderLineage(current);
  render();
});

canvas.addEventListener('pointermove', (event) => {
  if (pan && event.pointerId === pan.pointerId) {
    if (Math.hypot(event.clientX - pan.startX, event.clientY - pan.startY) > 4) pan.moved = true;
    if (!pan.moved) return;
    const dx = (event.clientX - pan.lastX) / zoom, dy = (event.clientY - pan.lastY) / zoom;
    for (const node of nodes) {
      node.x += dx; node.y += dy;
      canvas.querySelector(`[data-id="${node.id}"]`)?.setAttribute('transform', `translate(${node.x}, ${node.y})`);
    }
    pan.lastX = event.clientX; pan.lastY = event.clientY;
    translateConnections(dx, dy);
    return;
  }
  if (!drag) return;
  const dx = (event.clientX - drag.startX) / zoom;
  const dy = (event.clientY - drag.startY) / zoom;
  if (Math.hypot(dx, dy) > 4) drag.moved = true;
  if (!drag.moved) return;
  recordPositionChange();
  drag.node.x = Math.max(8, Math.min(sceneWidth() - width - 8, drag.x + dx));
  drag.node.y = Math.max(8, Math.min(sceneHeight() - nodeHeight(drag.node) - 8, drag.y + dy));
  canvas.querySelector(`[data-id="${drag.node.id}"]`)?.setAttribute('transform', `translate(${drag.node.x}, ${drag.node.y})`);
  renderEdges();
});
canvas.addEventListener('pointerup', (event) => {
  if (pan && event.pointerId === pan.pointerId) {
    const moved = pan.moved;
    pan = null; canvas.classList.remove('panning');
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!moved && (selected || columnFilter)) select(null);
    else scheduleSave();
    return;
  }
  if (!drag) return;
  const { node, moved } = drag;
  drag = null;
  if (!moved) select(node.id);
  else { render(); scheduleSave(); }
});
const cancelCanvasDrag = () => {
  const wasDragging = drag?.moved;
  drag = null; pan = null; canvas.classList.remove('panning');
  if (wasDragging) render();
  scheduleSave();
};
canvas.addEventListener('pointercancel', cancelCanvasDrag);
canvas.addEventListener('lostpointercapture', cancelCanvasDrag);
canvas.addEventListener('pointerdown', stopNavigation, { capture: true });
canvas.addEventListener('wheel', event => {
  if (event.ctrlKey) { event.preventDefault(); setZoom(zoom * Math.exp(-event.deltaY * .01)); return; }
  if (event.metaKey) return;
  const target = event.target instanceof Element ? event.target : null;
  const scroller = target?.closest<HTMLElement>('.node-columns, .column-details');
  if (scroller && scroller.scrollHeight > scroller.clientHeight && Math.abs(event.deltaY) >= Math.abs(event.deltaX) && !event.shiftKey) return;
  event.preventDefault();
  if (pan || drag) return;
  stopNavigation();
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? canvas.clientHeight : 1;
  const dx = (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit / zoom;
  const dy = (event.shiftKey && !event.deltaX ? 0 : event.deltaY) * unit / zoom;
  for (const node of nodes) {
    node.x -= dx; node.y -= dy;
    canvas.querySelector(`[data-id="${node.id}"]`)?.setAttribute('transform', `translate(${node.x}, ${node.y})`);
  }
  translateConnections(-dx, -dy);
  scheduleSave();
}, { passive: false });
canvas.addEventListener('pointerdown', (event) => {
  if (event.target !== canvas || event.button !== 0 || pan || drag) return;
  event.preventDefault();
  pan = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
  canvas.classList.add('panning');
  canvas.setPointerCapture(event.pointerId);
});

function closeDrawer() {
  const previous = selected;
  const previousColumn = columnFilter;
  select(null);
  if (previousColumn) canvas.querySelector<HTMLElement>(`[data-column-ref='${columnRefKey(previousColumn.tableId, previousColumn.columnId)}']`)?.focus({ preventScroll: true });
  else canvas.querySelector<SVGGElement>(`[data-id="${previous}"]`)?.focus();
}
document.querySelector('#close-drawer')!.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && (selected || columnFilter)) closeDrawer(); });
document.querySelector('#table-form')!.addEventListener('submit', (event) => event.preventDefault());
nameInput.addEventListener('input', () => {
  const node = nodes.find((item) => item.id === selected);
  if (!node) return;
  node.name = nameInput.value;
  render();
});
logicInput.addEventListener('input', () => {
  const node = nodes.find(item => item.id === selected);
  if (!node) return;
  node.logic = logicInput.value;
  scheduleSave();
});
const namespacePickers = ([['database', databaseInput], ['schema', schemaInput]] as const).map(([field, input]) =>
  autocomplete(input, () => nodes.map(node => node[field]), value => {
    const node = nodes.find(item => item.id === selected);
    if (!node) return;
    node[field] = value;
    render();
  })
);

document.querySelector('#add-column')!.addEventListener('click', () => {
  const node = nodes.find((item) => item.id === selected);
  if (!node) return;
  node.columns.push({ id: crypto.randomUUID(), name: '', type: 'STRING', precision: 18, scale: 2 });
  renderColumns(node);
  render();
  columnList.querySelector<HTMLInputElement>('.column-row:last-child input')?.focus();
});

function renderColumns(node: TableNode) {
  columnList.replaceChildren();
  node.columns.forEach((column, index) => {
    const row = document.createElement('div');
    row.className = 'column-row';
    row.dataset.columnId = column.id;
    const handle = document.createElement('button');
    handle.type = 'button'; handle.className = 'column-grip';
    handle.setAttribute('aria-label', `Reorder column ${index + 1}`);
    handle.title = 'Drag to reorder. Use ↑ or ↓ when focused.';
    handle.innerHTML = '<i data-lucide="grip-vertical"></i>';
    const moveColumn = (to: number) => {
      if (to < 0 || to >= node.columns.length || to === index) return;
      node.columns.splice(index, 1);
      node.columns.splice(to, 0, column);
      renderColumns(node); render();
      columnList.querySelector<HTMLButtonElement>(`[data-column-id="${column.id}"] .column-grip`)?.focus({ preventScroll: true });
    };
    handle.addEventListener('keydown', event => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault(); moveColumn(index + (event.key === 'ArrowUp' ? -1 : 1));
      }
    });
    let dropIndex: number | null = null;
    let startY = 0;
    const clearDrop = () => {
      row.classList.remove('reordering');
      columnList.querySelectorAll('.drop-before, .drop-after').forEach(item => item.classList.remove('drop-before', 'drop-after'));
    };
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); handle.focus();
      startY = event.clientY; dropIndex = index;
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (dropIndex === null || Math.abs(event.clientY - startY) < 4) return;
      clearDrop(); row.classList.add('reordering');
      const panel = document.querySelector<HTMLElement>('.drawer-content')!;
      const bounds = panel.getBoundingClientRect();
      if (event.clientY > bounds.bottom - 40) panel.scrollTop += 14;
      if (event.clientY < bounds.top + 40) panel.scrollTop -= 14;
      const others = [...columnList.querySelectorAll<HTMLElement>('.column-row')].filter(item => item !== row);
      const before = others.findIndex(item => { const rect = item.getBoundingClientRect(); return event.clientY < rect.top + rect.height / 2; });
      dropIndex = before < 0 ? others.length : before;
      if (before < 0) others.at(-1)?.classList.add('drop-after');
      else others[before].classList.add('drop-before');
    });
    handle.addEventListener('pointerup', () => {
      const to = dropIndex; dropIndex = null; clearDrop();
      if (to !== null) moveColumn(to);
    });
    handle.addEventListener('pointercancel', () => { dropIndex = null; clearDrop(); });
    const name = document.createElement('input');
    name.value = column.name;
    name.placeholder = 'Column name';
    name.maxLength = 80;
    name.setAttribute('aria-label', `Column ${index + 1} name`);
    name.addEventListener('input', () => { column.name = name.value; render(); });
    const type = document.createElement('select');
    type.setAttribute('aria-label', `Column ${index + 1} data type`);
    for (const value of DATA_TYPES) type.add(new Option(value.toLowerCase(), value));
    type.value = column.type;
    type.addEventListener('change', () => {
      column.type = type.value as Column['type'];
      renderColumns(node); render();
      columnList.querySelector<HTMLSelectElement>(`[data-column-id="${column.id}"] > select`)?.focus();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-column';
    remove.setAttribute('aria-label', `Remove column ${index + 1}`);
    remove.innerHTML = '<i data-lucide="trash-2"></i>';
    remove.addEventListener('click', () => { node.columns.splice(index, 1); renderColumns(node); render(); document.querySelector<HTMLButtonElement>('#add-column')!.focus(); });
    row.append(handle, name, type, remove);
    if (column.type === 'DECIMAL') {
      const params = document.createElement('div');
      params.className = 'type-parameters';
      for (const key of ['precision', 'scale'] as const) {
        const label = document.createElement('label');
        label.textContent = key === 'precision' ? 'Precision' : 'Scale';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = key === 'precision' ? '1' : '0';
        input.max = key === 'precision' ? '38' : String(column.precision);
        input.value = String(column[key]);
        input.setAttribute('aria-label', `Column ${index + 1} ${key}`);
        input.addEventListener('change', () => {
          const value = Number(input.value);
          column[key] = Math.max(key === 'precision' ? 1 : 0, Math.min(key === 'precision' ? 38 : column.precision, Number.isFinite(value) ? Math.trunc(value) : column[key]));
          column.scale = Math.min(column.scale, column.precision);
          renderColumns(node); render();
        });
        label.append(input); params.append(label);
      }
      row.append(params);
    }
    const mappingButton = document.createElement('button');
    mappingButton.type = 'button'; mappingButton.className = `mapping-toggle mapping-${column.mapping?.kind ?? 'unset'}`;
    const keyBadges = document.createElement('button'); keyBadges.type = 'button'; keyBadges.className = 'column-summary-keys';
    keyBadges.setAttribute('aria-label', `Edit key flags for column ${index + 1}`);
    keyBadges.title = 'Edit key flags';
    keyBadges.setAttribute('aria-expanded', String(expandedColumn === column.id && columnEditor === 'keys'));
    keyBadges.addEventListener('click', () => {
      expandedColumn = column.id; columnEditor = 'keys';
      renderColumns(node); render();
      const keys = columnList.querySelector<HTMLElement>(`[data-column-id="${column.id}"] .key-toggles`);
      keys?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      keys?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    });
    for (const [enabled, label, description] of [[column.primaryKey, 'PK', 'Primary key'], [column.foreignKey, 'FK', 'Foreign key'], [column.businessKey, 'BK', 'Business key']] as const) {
      if (!enabled) continue;
      const badge = document.createElement('span'); badge.className = 'column-key'; badge.textContent = label; badge.title = description; badge.setAttribute('aria-label', description); keyBadges.append(badge);
    }
    if (!keyBadges.children.length) keyBadges.textContent = '—';
    const logicLabel = document.createElement('span'); logicLabel.textContent = column.mapping ? mappingLabels[column.mapping.kind] : '—';
    const dot = document.createElement('span'); dot.className = 'mapping-dot'; dot.setAttribute('aria-hidden', 'true');
    mappingButton.append(dot, logicLabel);
    mappingButton.setAttribute('aria-label', `Define logic for column ${index + 1}`);
    mappingButton.setAttribute('aria-expanded', String(expandedColumn === column.id && columnEditor === 'logic'));
    mappingButton.addEventListener('click', () => { expandedColumn = expandedColumn === column.id && columnEditor === 'logic' ? null : column.id; columnEditor = 'logic'; renderColumns(node); render(); });
    row.append(keyBadges, mappingButton);
    if (expandedColumn === column.id) row.append(mappingEditor(node, column, index));
    columnList.append(row);
  });
  icons();
}

let restoringTraceView=false;
// Move the scene with the drawer edge and keep the edited table inside the viewport.
new ResizeObserver(() => {
  if (!canvas.clientWidth||restoringTraceView) return;
  const nextWidth = sceneWidth();
  canvas.setAttribute('viewBox', `0 0 ${sceneWidth()} ${sceneHeight()}`);
  let shift = nextWidth - viewportWidth;
  const active = nodes.find(node => node.id === (columnFilter?.tableId ?? selected));
  if (active && app.classList.contains('drawer-open')) {
    const margin = 24 / zoom;
    const availableRight = nextWidth - margin - width;
    const proposed = active.x + shift;
    const visibleX = Math.max(margin, Math.min(availableRight, proposed));
    shift += visibleX - proposed;
  }
  for (const node of nodes) node.x += shift;
  viewportWidth = nextWidth;
  for (const node of nodes) canvas.querySelector(`[data-id="${node.id}"]`)?.setAttribute('transform', `translate(${node.x}, ${node.y})`);
  translateConnections(shift, 0);
}).observe(canvas);

// Preserve route corridors throughout a gesture; solve again on release.
function stableDragRoute(key: string, source: TableNode, target: TableNode, calculate: () => {x:number;y:number}[]) {
  const saved = dragRoutes.get(key);
  if (!drag?.moved || !saved) {
    const raw = calculate();
    const points = raw.filter((p, i) => !i || i === raw.length - 1 || !((raw[i-1].x === p.x && p.x === raw[i+1].x) || (raw[i-1].y === p.y && p.y === raw[i+1].y)));
    if (points.length === 2) {
      const [a,b] = points; const x = (a.x + b.x) / 2;
      points.splice(1, 0, {x, y:a.y}, {x, y:b.y});
    }
    dragRoutes.set(key, {points, source:{x:source.x,y:source.y}, target:{x:target.x,y:target.y}});
    return points;
  }
  const points = saved.points.map(p => ({...p}));
  if (points.length < 4) return points;
  const dx1 = source.x - saved.source.x, dy1 = source.y - saved.source.y;
  const dx2 = target.x - saved.target.x, dy2 = target.y - saved.target.y;
  points[0].x += dx1; points[0].y += dy1;
  points[1].y += dy1;
  points[points.length-1].x += dx2; points[points.length-1].y += dy2;
  points[points.length-2].y += dy2;
  return points;
}

// Panning changes only the scene origin, never the geometry of a connection.
function translateConnections(dx: number, dy: number) {
  for (const layer of canvas.querySelectorAll<SVGGElement>('#lineage-edges, #column-edges')) {
    const x = Number(layer.dataset.panX ?? 0) + dx;
    const y = Number(layer.dataset.panY ?? 0) + dy;
    layer.dataset.panX = String(x); layer.dataset.panY = String(y);
    layer.setAttribute('transform', `translate(${x}, ${y})`);
  }
  // Keep the next node-drag baseline in the same world coordinates.
  for (const saved of dragRoutes.values()) {
    for (const p of saved.points) { p.x += dx; p.y += dy; }
    saved.source.x += dx; saved.source.y += dy;
    saved.target.x += dx; saved.target.y += dy;
  }
  clearTraceHover();
}

function addCrossingBridges(layer: Element, connections: {points: Point[]; path: SVGElement}[]) {
  const crossings = lineCrossings(connections.map(c => c.points));
  crossings.forEach((points, index) => {
    const original = connections[index].path;
    for (const {x,y} of points) {
      const group = svg('g', {'pointer-events':'none', 'aria-hidden':'true'});
      if (original.dataset.traceEdge) group.dataset.traceEdge = original.dataset.traceEdge;
      // Clear the straight section, then lift the horizontal line over the crossing.
      group.append(svg('path', {d:`M ${x-6} ${y} H ${x+6}`, stroke:'var(--surface-14)', 'stroke-width':'4', fill:'none'}));
      const d = `M ${x-6} ${y} C ${x-6} ${y-8}, ${x+6} ${y-8}, ${x+6} ${y}`;
      group.append(svg('path', {d, stroke:'var(--surface-14)', 'stroke-width':'5', fill:'none'}));
      group.append(svg('path', {d, stroke:original.getAttribute('stroke') ?? 'var(--line-96)', 'stroke-width':'1.5', fill:'none', 'stroke-linecap':'round'}));
      layer.append(group);
    }
  });
}

function renderEdges() {
  const layer = canvas.querySelector('#lineage-edges');
  if (!layer) return;
  layer.replaceChildren();
  const origin = nodes[0] ?? { x: 0, y: 0 };
  const boxes = nodes.map(n => ({ id:n.id,x:n.x-origin.x,y:n.y-origin.y,width,height:nodeHeight(n) }));
  const links = nodes.flatMap(n => n.upstream.filter(id=>nodes.some(t=>t.id===id)).map(source=>({source,target:n.id})));
  const key = JSON.stringify([boxes,links]);
  if (!drag?.moved && key !== routeCacheKey) { routeCacheKey=key; routeCache=routeEdges(boxes,links); }
  layer.removeAttribute('transform');
  layer.removeAttribute('data-pan-x'); layer.removeAttribute('data-pan-y');
  const connections: {points: Point[]; path: SVGElement}[] = [];
  const arrowPorts = new Set<string>();
  for (const edge of routeCache) {
    const source=nodes.find(n=>n.id===edge.source)!,target=nodes.find(n=>n.id===edge.target)!;
    const points = stableDragRoute('table:' + JSON.stringify([edge.source, edge.target]), source, target, () => edge.points.map(p => ({x:p.x + origin.x, y:p.y + origin.y})));
    const portKey = JSON.stringify(points.at(-1));
    const arrow = !arrowPorts.has(portKey); arrowPorts.add(portKey);
    const path = svg('path', { d:roundedPath(points),fill:'none',stroke:source.id===selected||target.id===selected?'var(--text-163)':'var(--line-96)','stroke-width':'1.5','marker-end':arrow?'url(#lineage-arrow)':'none',role:'img','aria-label':`${tableLabel(source)} → ${tableLabel(target)}` });
    layer.append(path); connections.push({points, path});
  }
  addCrossingBridges(layer, connections);
  renderColumnEdges();
}

function renderLineage(node: TableNode) {
  sourceList.replaceChildren();
  for (const id of node.upstream) {
    const source = nodes.find(item => item.id === id);
    if (!source) continue;
    const row = document.createElement('tr'); row.className = 'source-row';
    const label = document.createElement('button'); label.type = 'button'; label.className = 'source-navigation';
    label.textContent = source.name || 'Untitled table'; label.title = `Go to ${tableLabel(source)}`;
    label.setAttribute('aria-label', `Go to ${tableLabel(source)}`);
    label.addEventListener('click', () => navigateToTable(source.id));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-column';
    remove.setAttribute('aria-label', `Remove source ${tableLabel(source)}`);
    remove.innerHTML = '<i data-lucide="x"></i>';
    remove.addEventListener('click', () => { node.upstream = node.upstream.filter(sourceId => sourceId !== id); renderLineage(node); renderColumns(node); render(); sourceSelect.focus(); });
    const nameCell = document.createElement('td'); nameCell.append(label);
    row.append(nameCell);
    for (const value of [source.database, source.schema]) {
      const cell = document.createElement('td'); cell.textContent = value || '—'; cell.title = value; row.append(cell);
    }
    const actions = document.createElement('td'); actions.append(remove); row.append(actions);
    sourceList.append(row);
  }
  const candidates = nodes.filter(source => canAddSource(nodes, node.id, source.id));
  sourceSelect.replaceChildren(new Option('Add upstream table...', ''));
  for (const source of candidates) sourceSelect.add(new Option(tableLabel(source), source.id));
  sourceSelect.disabled = candidates.length === 0;
  icons();
}

sourceSelect.addEventListener('change', () => {
  const target = nodes.find(node => node.id === selected);
  if (!target || !canAddSource(nodes, target.id, sourceSelect.value)) return;
  target.upstream.push(sourceSelect.value);
  renderLineage(target); renderColumns(target); render();
});

function detailSourceTable(label: string, withRole: boolean): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'detail-sources';
  table.setAttribute('aria-label', label);
  const header = table.createTHead().insertRow();
  for (const title of withRole ? ['Column', 'Role'] : ['Column']) {
    const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = title; header.append(cell);
  }
  table.createTBody();
  return table;
}

function appendDetailSource(table: HTMLTableElement, source?: TableNode, input?: Column, role?: string, rules = '', warning = '') {
  const row = table.tBodies[0].insertRow();
  const field = row.insertCell();
  const name = document.createElement('span'); name.className = 'detail-source-name';
  name.textContent = input ? input.name || 'Unnamed column' : 'Missing column';
  field.append(name);
  const origin = document.createElement('span'); origin.className = 'detail-source-context';
  origin.textContent = source ? tableLabel(source) : 'Source no longer exists';
  field.append(origin);
  field.title = `${origin.textContent}.${name.textContent}`;
  if (role) {
    const usage = row.insertCell(); usage.className = 'detail-source-role'; usage.append(document.createTextNode(role));
    if (rules) {
      const reason = document.createElement('span'); reason.className = 'detail-source-context'; reason.textContent = rules; usage.append(reason);
    }
  }
  if (warning) {
    const note = document.createElement('span'); note.className = 'detail-source-context'; note.textContent = warning; field.append(note);
  }
  return row;
}

function captureLineageView(){
  const saved={zoom,selected,filter:columnFilter?{...columnFilter}:null,traceDirection,showDependencies,positions:nodes.map(n=>({id:n.id,x:n.x,y:n.y})),scroll:drawer.querySelector('.drawer-content')!.scrollTop};
  return ()=>{stopNavigation();restoringTraceView=true;zoom=saved.zoom;traceDirection=saved.traceDirection;showDependencies=saved.showDependencies;select(saved.selected);columnFilter=saved.filter;render();
    const restore=()=>{for(const node of nodes){const p=saved.positions.find(p=>p.id===node.id);if(p){node.x=p.x;node.y=p.y;}}viewportWidth=sceneWidth();canvas.setAttribute('viewBox',`0 0 ${sceneWidth()} ${sceneHeight()}`);render();drawer.querySelector('.drawer-content')!.scrollTop=saved.scroll;};restore();setTimeout(()=>{restore();restoringTraceView=false;},500);
  };
}

function renderTraceDrawer() {
  const content=drawer.querySelector<HTMLElement>('.drawer-content')!;
  content.querySelector('.trace-inspector')?.remove();
  drawer.classList.toggle('showing-trace',!!columnFilter);
  content.querySelector('header > span')!.textContent=columnFilter?'Column lineage':'Table properties';
  drawer.setAttribute('aria-label',columnFilter?'Column lineage':'Table properties');
  if(!columnFilter)return;
  const node=nodes.find(n=>n.id===columnFilter!.tableId);
  const column=node?.columns.find(c=>c.id===columnFilter!.columnId);
  if(!node||!column)return;
  drawer.inert=false;app.classList.add('drawer-open');
  const inspector=document.createElement('div');inspector.className='trace-inspector';
  const title=document.createElement('h2');title.textContent=column.name;
  const context=document.createElement('p');context.className='trace-inspector-context';context.textContent=tableLabel(node);
  inspector.append(title,context,renderColumnDetails(node,column));
  const usage=document.createElement('section');usage.className='semantic-usage';const heading=document.createElement('h3');heading.textContent='Used by';usage.append(heading);
  document.dispatchEvent(new CustomEvent('request-semantic-usage',{detail:{tableId:node.id,columnId:column.id,container:usage,restore:captureLineageView()}}));
  if(usage.children.length===1){const empty=document.createElement('p');empty.textContent='No semantic bindings defined.';usage.append(empty);}inspector.append(usage);content.append(inspector);
}

function renderColumnDetails(node: TableNode, column: Column): HTMLElement {
  const columnDetails = document.createElement('section');
  columnDetails.className = 'column-details';
  columnDetails.setAttribute('aria-label', `Logic for ${column.name || 'Column'}`);
  columnDetails.tabIndex = 0;
  for (const type of ['pointerdown', 'click', 'keydown']) {
    columnDetails.addEventListener(type, event => { if (!(event instanceof KeyboardEvent) || event.key !== 'Escape') event.stopPropagation(); });
  }
  const text = (tag: string, value: string, className = '') => {
    const element = document.createElement(tag); element.textContent = value; element.className = className; return element;
  };
  const header = document.createElement('header');
  const mapping = column.mapping;
  header.append(text('h3', mapping?.kind === 'derived' ? 'Expression / rule' : mapping ? (mapping.kind === 'external' ? 'External source' : (mapping.sources.length === 1 ? 'Source' : 'Sources')) : 'Logic'));
  columnDetails.append(header);
  if (mapping) {
    if (mapping.kind === 'external') columnDetails.append(text('p', mapping.externalSource || 'External source not specified.', 'detail-description'));
    if (mapping.kind === 'derived') {
      columnDetails.append(text(mapping.expression.trim() ? 'pre' : 'p', mapping.expression.trim() || 'No derivation has been written yet.', mapping.expression.trim() ? 'detail-expression' : 'detail-description'));
    }
    if (mapping.kind === 'derived') columnDetails.append(text('h3', mapping.sources.length === 1 ? 'Source' : 'Sources'));
    const inputs = columnInputs(node, column).filter(ref => showDependencies || ref.role !== 'dependency');
    const sources = detailSourceTable('Source columns', true);
    for (const ref of inputs) {
      const source = nodes.find(item => item.id === ref.tableId);
      const input = source?.columns.find(item => item.id === ref.columnId);
      const rules = [...new Set((node.ruleDependencies ?? []).filter(rule=>rule.tableId===ref.tableId && rule.columnId===ref.columnId).map(rule=>rule.rule))];
      const row = appendDetailSource(sources, source, input, ref.role === 'dependency' ? 'Dependency' : 'Value', rules.join(', '), source && !node.upstream.includes(source.id) ? 'Not upstream' : '');
      wireTraceHover(row, traceEdgeKey(ref.tableId, ref.columnId, node.id, column.id), dependencyLabel(node, ref));
    }
    if (inputs.length) columnDetails.append(sources);
    else if (mapping.kind !== 'external') columnDetails.append(text('p', mapping.noInputs ? 'No upstream value dependency declared.' : 'No source columns defined. Lineage is incomplete.', 'detail-description'));
  } else columnDetails.append(text('p', 'No logic defined for this column yet.', 'detail-description'));
  if (traceDirection === 'downstream') {
    // The same compact panel describes forward impact when tracing downstream.
    for (const child of [...columnDetails.children]) if (child !== header) child.remove();
    header.querySelector('h3')!.textContent = 'Affected columns';
    const affected = downstreamColumns(nodes, node.id, column.id, showDependencies);
    const list = detailSourceTable('Affected columns', false);
    for (const key of affected) {
      const [tableId, columnId] = JSON.parse(key);
      const table = nodes.find(n => n.id === tableId)!;
      const target = table.columns.find(c => c.id === columnId)!;
      appendDetailSource(list, table, target);
    }
    if (affected.size) columnDetails.append(text('p', 'Defined dependencies only; other consumers may not be modelled.', 'detail-description'));
    columnDetails.append(affected.size ? list : text('p', 'No downstream relations defined. Unmodelled dependencies may exist.', 'detail-description'));
  }
  const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'detail-edit'; edit.innerHTML = '<i data-lucide="pencil"></i>'; edit.title = 'Edit column logic'; edit.setAttribute('aria-label', 'Edit column logic');
  edit.addEventListener('click', () => {
    expandedColumn = column.id; columnEditor = 'logic'; select(node.id);
    const row = columnList.querySelector<HTMLElement>(`[data-column-id="${column.id}"]`);
    row?.scrollIntoView({ block: 'nearest' });
    row?.querySelector<HTMLSelectElement>('.mapping-editor select')?.focus({ preventScroll: true });
  });
  const actions = document.createElement('div'); actions.className = 'detail-actions';
  actions.append(edit);
  header.append(actions);
  return columnDetails;
}

initCanvasTools();
render();
if (freshExample) fitCanvas();

function mappingEditor(node: TableNode, column: Column, index: number): HTMLElement {
  const panel = document.createElement('div'); panel.className = 'mapping-editor';
  const keys = document.createElement('div'); keys.className = 'key-toggles'; keys.setAttribute('role', 'group'); keys.setAttribute('aria-label', 'Column keys');
  for (const [field, label] of [['primaryKey', 'Primary key'], ['foreignKey', 'Foreign key'], ['businessKey', 'Business key']] as const) {
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = label;
    toggle.setAttribute('aria-label', `Column ${index + 1} ${label.toLowerCase()}`); toggle.setAttribute('aria-pressed', String(!!column[field]));
    toggle.addEventListener('click', () => { column[field] = !column[field]; renderColumns(node); render(); });
    keys.append(toggle);
  }
  const keyLabel = document.createElement('span'); keyLabel.className = 'editor-label'; keyLabel.textContent = 'Keys';
  if (columnEditor === 'keys') {
    panel.append(keyLabel, keys);
    return panel;
  }
  const kind = document.createElement('select'); kind.setAttribute('aria-label', `Column ${index + 1} logic type`);
  kind.add(new Option('Not defined', ''));
  for (const [value, label] of Object.entries(mappingLabels)) kind.add(new Option(label, value));
  kind.value = column.mapping?.kind ?? '';
  kind.addEventListener('change', () => {
    if (!kind.value) delete column.mapping;
    else column.mapping = { kind: kind.value as NonNullable<Column['mapping']>['kind'], sources: kind.value === 'external' ? [] : column.mapping?.sources ?? [], expression: column.mapping?.expression ?? '', noInputs: kind.value === 'derived' && column.mapping?.noInputs || undefined, externalSource: column.mapping?.externalSource };
    renderColumns(node); render();
  });
  const kindLabel = document.createElement('span'); kindLabel.className = 'editor-label'; kindLabel.textContent = 'Logic';
  const kindRow = document.createElement('div'); kindRow.className = 'logic-type-row';
  kindRow.append(kindLabel, kind); panel.append(kindRow);
  const mapping = column.mapping;
  if (!mapping) return panel;
  if (mapping.kind === 'external') {
    const origin = document.createElement('input'); origin.value = mapping.externalSource ?? ''; origin.placeholder = 'System / object / field…'; origin.setAttribute('aria-label', `Column ${index + 1} external source`);
    origin.addEventListener('input', () => { mapping.externalSource = origin.value; render(); }); panel.append(origin);
    return panel;
  }
  if (mapping.sources.length) {
    const headings = document.createElement('div'); headings.className = 'logic-source-heading'; headings.setAttribute('aria-hidden', 'true');
    for (const title of ['Source table', 'Column', 'Use', '']) { const label = document.createElement('span'); label.textContent = title; headings.append(label); }
    panel.append(headings);
  }
  for (const [sourceIndex, ref] of mapping.sources.entries()) {
    const sourceTable = nodes.find(item => item.id === ref.tableId);
    const sourceColumn = sourceTable?.columns.find(item => item.id === ref.columnId);
    const sourceRow = document.createElement('div'); sourceRow.className = 'mapping-source-reference';
    const label = document.createElement('span');
    label.textContent = sourceTable ? tableLabel(sourceTable) : 'Missing table';
    if (!node.upstream.includes(ref.tableId)) label.textContent += ' (not upstream)';
    label.title = label.textContent;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-column';
    remove.setAttribute('aria-label', `Remove input ${sourceIndex + 1} for column ${index + 1}`); remove.innerHTML = '<i data-lucide="x"></i>';
    remove.addEventListener('click', () => { mapping.sources.splice(sourceIndex, 1); renderColumns(node); render(); });
    const field = document.createElement('span'); field.textContent = sourceColumn?.name || (sourceColumn ? 'Unnamed column' : 'Missing column'); field.title = field.textContent;
    const role = document.createElement('select'); role.className = 'input-role'; role.setAttribute('aria-label', `Input ${sourceIndex + 1} use for column ${index + 1}`);
    role.add(new Option('Value', 'value')); role.add(new Option('Dependency', 'dependency')); role.value = ref.role ?? 'value';
    role.addEventListener('change', () => { ref.role = role.value as 'value' | 'dependency'; render(); });
    sourceRow.append(label, field, role, remove); panel.append(sourceRow);
  }
  {
    const newRole = document.createElement('select'); newRole.className = 'input-role'; newRole.setAttribute('aria-label', `New input use for column ${index + 1}`);
    const hasValue = mapping.sources.some(ref=>ref.role !== 'dependency');
    if (mapping.kind === 'derived' || !hasValue) newRole.add(new Option('Value','value'));
    newRole.add(new Option('Dependency','dependency'));
    const source = document.createElement('select'); source.setAttribute('aria-label', `Column ${index + 1} source column`);
    source.add(new Option('Add input column…', ''));
    for (const upstream of nodes.filter(item => node.upstream.includes(item.id))) {
      const group = document.createElement('optgroup'); group.label = tableLabel(upstream);
      for (const candidate of upstream.columns) {
        if (!mapping.sources.some(ref => ref.tableId === upstream.id && ref.columnId === candidate.id)) group.append(new Option(candidate.name || 'Unnamed column', JSON.stringify({ tableId: upstream.id, columnId: candidate.id })));
      }
      if (group.children.length) source.append(group);
    }
    source.disabled = source.options.length === 1;
    source.addEventListener('change', () => {
      if (!source.value) return;
      const ref = { ...JSON.parse(source.value), role: newRole.value as 'value' | 'dependency' };
      mapping.sources.push(ref);
      const inputColumn = nodes.find(item => item.id === ref.tableId)?.columns.find(item => item.id === ref.columnId);
      if (inputColumn && mapping.kind !== 'derived' && ref.role === 'value') {
        column.type = inputColumn.type;
        column.precision = inputColumn.precision;
        column.scale = inputColumn.scale;
        if (mapping.kind === 'source') column.name = inputColumn.name;
      }
      renderColumns(node); render();
    });
    const addInput = document.createElement('div'); addInput.className = 'add-logic-input'; addInput.append(source,newRole); panel.append(addInput);
    if (source.disabled && mapping.sources.length === 0) {
      const hint = document.createElement('p'); hint.className = 'mapping-help'; hint.textContent = 'Assign an upstream table with columns to choose a source.'; panel.append(hint);
    }
  }
  if (mapping.kind === 'derived') {
    const independence = document.createElement('label'); independence.className = 'independent-input';
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = !!mapping.noInputs;
    check.addEventListener('change', () => { mapping.noInputs = check.checked; render(); });
    independence.append(check, document.createTextNode('No upstream value dependency (constant or generated value)')); panel.append(independence);
    const expression = document.createElement('textarea'); expression.rows = 4; expression.value = mapping.expression;
    expression.spellcheck = false; expression.placeholder = 'e.g. coalesce(account_name, company_name)\nOr describe the derivation in plain language.';
    expression.setAttribute('aria-label', `Column ${index + 1} derivation`);
    expression.addEventListener('input', () => { mapping.expression = expression.value; render(); });
    panel.append(expression);
  }
  return panel;
}

const traceEdgeKey = (source: string, input: string, target: string, output: string) => JSON.stringify([source, input, target, output]);
function dependencyLabel(table: TableNode, ref: {tableId: string; columnId: string; role?: string}) {
  if (ref.role !== 'dependency') return 'Value';
  const rules = [...new Set((table.ruleDependencies ?? []).filter(r => r.tableId === ref.tableId && r.columnId === ref.columnId).map(r => r.rule))];
  return rules.length ? `${rules.join(', ')} dependency` : 'Dependency';
}
function clearTraceHover() {
  document.querySelector('#trace-tooltip')?.remove();
  canvas.querySelectorAll<SVGElement>('[data-trace-edge]').forEach(el => { el.style.opacity = ''; });
}
function wireTraceHover(element: Element, key: string, label: string) {
  const highlight = (event: Event) => {
    clearTraceHover();
    canvas.querySelectorAll<SVGElement>('[data-trace-edge]').forEach(el => { el.style.opacity = el.dataset.traceEdge === key ? '1' : '.12'; });
    const tooltip = document.createElement('div'); tooltip.id = 'trace-tooltip'; tooltip.textContent = label;
    const rect = element.getBoundingClientRect();
    const x = event instanceof MouseEvent ? event.clientX : rect.left;
    const y = event instanceof MouseEvent ? event.clientY : rect.top;
    tooltip.style.left = `${Math.min(x + 12, window.innerWidth - 200)}px`;
    tooltip.style.top = `${Math.max(8, y - 30)}px`;
    document.body.append(tooltip);
  };
  element.addEventListener('mouseenter', highlight);
  element.addEventListener('mouseleave', clearTraceHover);
  if (element instanceof HTMLTableRowElement) {
    element.tabIndex = 0;
    element.addEventListener('focus', highlight);
    element.addEventListener('blur', clearTraceHover);
  }
}

function renderColumnEdges() {
  clearTraceHover();
  canvas.querySelector('#column-edges')?.remove();
  if (!columnFilter) return;
  const layer = svg('g', { id: 'column-edges', 'pointer-events': 'none' });
  const connections: {points: Point[]; path: SVGElement}[] = [];
  const keys = filteredColumnContext().columns;
  keys.add(columnRefKey(columnFilter.tableId, columnFilter.columnId));
  const bounds = canvas.getBoundingClientRect();
  const port = (table: TableNode, columnId: string, right: boolean) => {
    const row = [...canvas.querySelectorAll<HTMLElement>('.node-column')].find(el => el.dataset.columnRef === columnRefKey(table.id, columnId));
    const body = row?.closest('.node-columns');
    if (!row || !body) return null;
    const r = row.getBoundingClientRect(), b = body.getBoundingClientRect();
    const y = Math.max(b.top + 4, Math.min(b.bottom - 4, r.top + r.height / 2));
    return { x: table.x + (right ? width : 0), y: (y - bounds.top) / zoom, clipped: r.top < b.top || r.bottom > b.bottom };
  };
  for (const table of nodes) for (const column of table.columns) {
    if (!keys.has(columnRefKey(table.id, column.id))) continue;
    for (const ref of columnInputs(table, column)) {
      if (!showDependencies && ref.role === 'dependency') continue;
      if (!keys.has(columnRefKey(ref.tableId, ref.columnId)) || !table.upstream.includes(ref.tableId)) continue;
      const source = nodes.find(n => n.id === ref.tableId); if (!source) continue;
      const forward = table.x >= source.x;
      const a = port(source, ref.columnId, forward), b = port(table, column.id, !forward); if (!a || !b) continue;
      const points = stableDragRoute('column:' + traceEdgeKey(source.id, ref.columnId, table.id, column.id), source, table, () => routeEdges(nodes.map(n=>({id:n.id,x:n.x,y:n.y,width,height:nodeHeight(n)})),[{source:source.id,target:table.id,sourceY:a.y,targetY:b.y}])[0]?.points ?? []);
      if (!points.length) continue;
      const color = column.mapping?.kind === 'derived' ? 'var(--accent-purple)' : column.mapping?.kind === 'alias' ? 'var(--accent-blue)' : 'var(--accent-green)';
      const path = svg('path', { d: roundedPath(points), fill: 'none', stroke: color, 'stroke-width': '1.5', 'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': ref.role === 'dependency' ? '7 5' : 'none', role: 'img', 'aria-label': `${ref.role === 'dependency' ? 'Dependency' : 'Value'}: ${tableLabel(source)} → ${tableLabel(table)}.${column.name}` });
      const key = traceEdgeKey(source.id, ref.columnId, table.id, column.id);
      path.dataset.traceEdge = key;
      const hit = svg('path', {d: roundedPath(points), fill: 'none', stroke: 'transparent', 'stroke-width': '12', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'stroke'});
      wireTraceHover(hit, key, dependencyLabel(table, ref));
      hit.addEventListener('pointerdown', event => event.stopPropagation());
      layer.append(path, hit);
      connections.push({points, path});
      for (const endpoint of [a, b]) if (endpoint.clipped) {
        const marker = svg('circle', {cx:String(endpoint.x), cy:String(endpoint.y), r:'4', fill:'var(--surface-24)', stroke:color, 'stroke-width':'1.5', 'vector-effect':'non-scaling-stroke'});
        const title = svg('title', {}); title.textContent = 'Column is outside the visible rows'; marker.append(title); layer.append(marker);
      }
      if (!b.clipped) layer.append(svg('circle', { cx: String(b.x), cy: String(b.y), r: '3', fill: color }));
    }
  }
  addCrossingBridges(layer, connections);
  canvas.append(layer);
}

function renderTransformation(node: TableNode) {
  let fields = document.querySelector('#transformation-fields');
  if (!fields) { fields = document.createElement('div'); fields.id = 'transformation-fields'; document.querySelector('.transformation')!.append(fields); }
  fields.replaceChildren();
  const explanation = document.createElement('p'); explanation.className = 'mapping-help'; explanation.textContent = 'Link rule inputs explicitly. They affect every output column; notes alone do not create lineage.'; fields.append(explanation);
  for (const [key, title, placeholder] of [
    ['joins', 'Joins', 'Tables, join keys, and join types…'],
    ['filters', 'Filters', 'Which rows are included or excluded?'],
    ['deduplication', 'Deduplication', 'Uniqueness keys and which record wins…'],
    ['aggregation', 'Aggregation / grain', 'One row per… Grouping and aggregate rules…'],
    ['loading', 'Loading', 'Full or incremental, watermark, merge keys, delete handling…']
  ] as const) {
    const label = document.createElement('label'); label.textContent = title;
    const input = document.createElement('textarea'); input.rows = 2; input.placeholder = placeholder; input.value = node.transformation?.[key] ?? ''; input.setAttribute('aria-label', title);
    input.addEventListener('input', () => { node.transformation ??= {}; node.transformation[key] = input.value; scheduleSave(); });
    label.append(input); fields.append(label);
    const dependencies = document.createElement('div'); dependencies.className = 'rule-dependencies';
    for (const [i, ref] of (node.ruleDependencies ?? []).entries()) {
      if (ref.rule !== key) continue;
      const table = nodes.find(n => n.id === ref.tableId), column = table?.columns.find(c => c.id === ref.columnId);
      const row = document.createElement('div'); row.className = 'rule-dependency';
      const name = document.createElement('span'); name.textContent = table && column ? `${tableLabel(table)}.${column.name}` : 'Missing dependency column';
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-column'; remove.innerHTML = '<i data-lucide="x"></i>'; remove.setAttribute('aria-label', `Remove ${key} dependency ${i+1}`);
      remove.addEventListener('click', () => { node.ruleDependencies!.splice(i,1); renderTransformation(node); render(); });
      row.append(name,remove); dependencies.append(row);
    }
    const source = document.createElement('select'); source.setAttribute('aria-label', `${title} dependency column`); source.add(new Option('Add rule dependency…',''));
    for (const table of nodes.filter(n => node.upstream.includes(n.id))) {
      const group = document.createElement('optgroup'); group.label = tableLabel(table);
      for (const column of table.columns) if (!node.ruleDependencies?.some(ref => ref.rule===key && ref.tableId===table.id && ref.columnId===column.id)) group.append(new Option(column.name || 'Unnamed column', JSON.stringify({tableId:table.id,columnId:column.id,rule:key})));
      if (group.children.length) source.append(group);
    }
    source.disabled = source.options.length===1;
    source.addEventListener('change', () => { if (!source.value) return; node.ruleDependencies ??= []; node.ruleDependencies.push(JSON.parse(source.value)); renderTransformation(node); render(); });
    dependencies.append(source); fields.append(dependencies);
  }
  icons();
}
function setZoom(next: number) {
  stopNavigation();
  const beforeW = sceneWidth(), beforeH = sceneHeight();
  zoom = Math.max(.2, Math.min(2, next));
  const dx = (sceneWidth() - beforeW) / 2, dy = (sceneHeight() - beforeH) / 2;
  for (const node of nodes) {
    node.x += dx; node.y += dy;
    canvas.querySelector(`[data-id="${node.id}"]`)?.setAttribute('transform', `translate(${node.x}, ${node.y})`);
  }
  viewportWidth = sceneWidth();
  canvas.setAttribute('viewBox', `0 0 ${sceneWidth()} ${sceneHeight()}`);
  translateConnections(dx, dy);
  scheduleSave();
  document.querySelector('#zoom-level')!.textContent = `${Math.round(zoom * 100)}%`;
}
function fitCanvas() {
  if (!nodes.length) return;
  const left = Math.min(...nodes.map(n => n.x)), top = Math.min(...nodes.map(n => n.y));
  const right = Math.max(...nodes.map(n => n.x + width)), bottom = Math.max(...nodes.map(n => n.y + nodeHeight(n)));
  setZoom(Math.min(1, (canvas.clientWidth - 80) / (right - left), (canvas.clientHeight - 150) / (bottom - top)));
  const dx = (sceneWidth() - (right - left)) / 2 - Math.min(...nodes.map(n => n.x));
  const dy = (sceneHeight() - (bottom - top)) / 2 - Math.min(...nodes.map(n => n.y));
  nodes.forEach(n => { n.x += dx; n.y += dy; }); render();
}
function refreshValidation() {
  const list = document.querySelector('#validation-list'), button = document.querySelector('#validation-button');
  if (!list || !button) return;
  const issues = validateModel(nodes); button.classList.toggle('checks-clear', issues.length === 0); button.replaceChildren(createElement(CircleCheck,{width:16,height:16,'aria-hidden':'true'}),document.createTextNode(`Checks · ${issues.length}`));
  list.replaceChildren();
  if (!issues.length) list.textContent = 'No definition issues found.';
  for (const issue of issues) {
    const item = document.createElement('button'); item.type = 'button';
    item.textContent = `${tableLabel(nodes.find(n => n.id === issue.tableId)!)} — ${issue.message}`;
    item.addEventListener('click', () => {
      if (issue.columnId) { expandedColumn = issue.columnId; columnEditor = 'logic'; }
      navigateToTable(issue.tableId);
      if (issue.columnId) columnList.querySelector(`[data-column-id="${issue.columnId}"]`)?.scrollIntoView({ block: 'nearest' });
      (list as HTMLElement).hidden = true;
    }); list.append(item);
  }
}
function initCanvasTools() {
  const controls = document.createElement('div'); controls.className = 'canvas-navigation';
  const left = document.createElement('div'); left.className = 'canvas-controls-left';
  const right = document.createElement('div'); right.className = 'canvas-controls-right';
  left.setAttribute('role', 'group'); left.setAttribute('aria-label', 'Search and lineage');
  right.setAttribute('role', 'group'); right.setAttribute('aria-label', 'Canvas view');
  controls.append(left);
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Find table or column…'; search.setAttribute('aria-label', 'Find table or column');
  const results = document.createElement('div'); results.className = 'canvas-search-results'; results.hidden = true;
  search.addEventListener('input', () => {
    results.replaceChildren(); results.hidden = !search.value.trim();
    const query = search.value.toLowerCase().trim();
    const matches: { table: TableNode; column?: Column }[] = [];
    for (const table of nodes) {
      if (tableLabel(table).toLowerCase().includes(query)) matches.push({ table });
      for (const column of table.columns) if (column.name.toLowerCase().includes(query)) matches.push({ table, column });
    }
    for (const match of matches.slice(0, 30)) {
      const result = document.createElement('button'); result.type = 'button'; result.textContent = tableLabel(match.table) + (match.column ? ` · ${match.column.name}` : '');
      result.addEventListener('click', () => {
        results.hidden = true; search.value = '';
        if (match.column) { expandedColumn = match.column.id; columnEditor = 'logic'; }
        navigateToTable(match.table.id);
        if (match.column) {
          const i = match.table.columns.indexOf(match.column); columnScroll.set(match.table.id, i * 32);
          const body = canvas.querySelector<HTMLElement>(`[data-id="${match.table.id}"] .node-columns`); if (body) body.scrollTop = i * 32;
          columnList.querySelector(`[data-column-id="${match.column.id}"]`)?.scrollIntoView({ block: 'nearest' });
        }
      }); results.append(result);
    }
    if (!matches.length) results.textContent = 'No matches';
  });
  search.addEventListener('keydown', event => { if (event.key === 'Escape') { results.hidden = true; event.stopPropagation(); } if (event.key === 'ArrowDown') { event.preventDefault(); results.querySelector('button')?.focus(); } });
  left.append(search); controls.append(results);
  const action = (label: string, callback: () => void, id?: string, group = left) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (id) b.id = id; b.addEventListener('click', callback); group.append(b); return b; };
  action('−', () => setZoom(zoom / 1.2), undefined, right).setAttribute('aria-label', 'Zoom out');
  action(`${Math.round(zoom * 100)}%`, () => setZoom(1), 'zoom-level', right).setAttribute('aria-label', 'Reset zoom');
  action('+', () => setZoom(zoom * 1.2), undefined, right).setAttribute('aria-label', 'Zoom in');
  const impact = action('Impact', () => {
    traceDirection = traceDirection === 'upstream' ? 'downstream' : 'upstream';
    impact.setAttribute('aria-pressed', String(traceDirection === 'downstream'));
    render();
  });
  impact.dataset.traceControl = 'impact';
  impact.hidden = !columnFilter;
  impact.title = 'Trace downstream impact';
  impact.setAttribute('aria-label', 'Trace downstream impact');
  impact.setAttribute('aria-pressed', 'false');
  const dependencies = action('Show dependencies', () => {
    showDependencies = !showDependencies;
    dependencies.setAttribute('aria-pressed', String(showDependencies));
    render();
  });
  dependencies.dataset.traceControl = 'dependencies';
  dependencies.hidden = !columnFilter;
  dependencies.setAttribute('aria-pressed', 'false');
  action('Fit', fitCanvas, undefined, right);
  action('Arrange', () => { beginHistory();stopNavigation(); columnFilter = null; layoutTables(nodes); fitCanvas();commitHistory(); }, undefined, right);
  decorateCanvasControls(right);
  const checks = document.createElement('div'); checks.id = 'validation-list'; checks.className = 'validation-list'; checks.hidden = true;
  const checksButton = action('Checks', () => { checks.hidden = !checks.hidden; refreshValidation(); }, 'validation-button');
  left.insertBefore(checksButton, impact);
  const legend = document.createElement('div'); legend.id = 'trace-legend'; legend.hidden = true;
  legend.setAttribute('role', 'group'); legend.setAttribute('aria-label', 'Connection legend');
  for (const [kind, label, explanation] of [
    ['value', 'Value flow', 'Solid lines carry a column value.'],
    ['dependency', 'Dependency', 'Dashed lines affect the result through a join, filter, or other rule. Enable Show dependencies to see them.'],
    ['offscreen', 'Hidden row', 'An open endpoint marks a column outside its table’s visible rows. Scroll the table to see it.'],
  ]) {
    const item = document.createElement('span'); item.className = 'trace-legend-item'; item.title = explanation;
    const sample = svg('svg', {width: '28', height: '12', viewBox: '0 0 28 12', 'aria-hidden': 'true'});
    sample.append(svg('path', {d: kind === 'offscreen' ? 'M 1 6 H 19' : 'M 1 6 H 27', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', ...(kind === 'dependency' ? {'stroke-dasharray': '5 4'} : {})}));
    if (kind === 'offscreen') sample.append(svg('circle', {cx: '23', cy: '6', r: '3.5', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5'}));
    item.append(sample, document.createTextNode(label)); legend.append(item);
  }
  controls.append(checks); document.querySelector('.workspace')!.append(controls,right,legend);
}

initBusiness(nodes, `${modelStorageKey}:business`, isCompanyExample, () => encodeSnapshot(nodes,sceneWidth() || viewportWidth || 1266/zoom,zoom), (tableId, columnId) => {
  select(null);
  columnFilter = {tableId, columnId};
  traceDirection = 'upstream';
  render();
  const table = nodes.find(n => n.id === tableId);
  if (table) {
    const dx = (sceneWidth() - width) / 2 - table.x;
    const dy = Math.max(16, (sceneHeight() - nodeHeight(table)) / 2) - table.y;
    for (const node of nodes) {
      node.x += dx; node.y += dy;
      canvas.querySelector(`[data-id="${node.id}"]`)?.setAttribute('transform', `translate(${node.x}, ${node.y})`);
    }
    translateConnections(dx, dy);
    scheduleSave();
  }
});

registerHistory('physical',{read:()=>nodes,write:value=>{nodes.splice(0,nodes.length,...value);select(null);saveCanvas();}});
if(!isReadOnly())installHistory();

document.addEventListener('clear-lineage',()=>{if(isReadOnly())return;beginHistory();stopNavigation();nodes.splice(0);columnScroll.clear();select(null);saveCanvas();commitHistory();});

document.addEventListener('import-lineage',event=>{if(isReadOnly())return;const data=(event as CustomEvent<ReturnType<typeof decodeSnapshot>>).detail;stopNavigation();nodes.splice(0,nodes.length,...data.nodes);columnScroll.clear();columnFilter=null;select(null);if(canvas.clientWidth>0)fitCanvas();else{zoom=data.zoom??1;render();}saveCanvas();});

document.addEventListener('lineage-relationships-changed',()=>{render();saveCanvas();if(selected){const node=nodes.find(n=>n.id===selected);if(node)renderLineage(node);}});

document.addEventListener('navigate-lineage-table',event=>navigateToTable((event as CustomEvent<string>).detail));
document.addEventListener('fit-lineage',fitCanvas);
document.addEventListener('arrange-lineage',()=>{if(isReadOnly())return;beginHistory();stopNavigation();columnFilter=null;layoutTables(nodes);fitCanvas();commitHistory();});

