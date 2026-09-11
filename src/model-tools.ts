import type { TableNode } from './types';
import { columnRefKey, columnInputs } from './lineage';
export function downstreamColumns(nodes: TableNode[], tableId: string, columnId: string, includeDependencies = true) {
  const root = columnRefKey(tableId, columnId), visited = new Set([root]), result = new Set<string>();
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    for (const table of nodes) for (const column of table.columns) {
      if (!columnInputs(table, column).some(ref => (includeDependencies || ref.role !== 'dependency') && table.upstream.includes(ref.tableId) && columnRefKey(ref.tableId, ref.columnId) === current)) continue;
      const key = columnRefKey(table.id, column.id);
      if (!visited.has(key)) { visited.add(key); result.add(key); pending.push(key); }
    }
  }
  return result;
}
export interface Issue { tableId: string; columnId?: string; message: string }
export function validateModel(nodes: TableNode[]): Issue[] {
  const issues: Issue[] = [];
  for (const table of nodes) {
    const add = (message: string, columnId?: string) => issues.push({ tableId: table.id, columnId, message });
    if (!table.name.trim()) add('Table name is missing');
    const pending = [...table.upstream], visited = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (id === table.id) { add('Circular table lineage'); break; }
      if (visited.has(id)) continue;
      visited.add(id); pending.push(...(nodes.find(n => n.id === id)?.upstream ?? []));
    }
    for (const ref of table.ruleDependencies ?? []) {
      if (!table.upstream.includes(ref.tableId)) add(`${ref.rule}: dependency table is not upstream`);
      if (!nodes.find(n => n.id === ref.tableId)?.columns.some(c => c.id === ref.columnId)) add(`${ref.rule}: dependency column no longer exists`);
    }
    for (const rule of ['joins', 'filters', 'deduplication', 'aggregation', 'loading'] as const) {
      if (table.upstream.length && table.transformation?.[rule]?.trim() && !table.ruleDependencies?.some(ref => ref.rule === rule)) add(`${rule}: notes have no linked rule dependencies`);
    }
    const seen = new Set<string>();
    for (const column of table.columns) {
      if (!column.name.trim()) add('Column name is missing', column.id);
      else if (seen.has(column.name.toLowerCase())) add(`Duplicate column: ${column.name}`, column.id);
      seen.add(column.name.toLowerCase());
      const m = column.mapping;
      if (!m) { add(`${column.name || 'Column'}: logic not defined`, column.id); continue; }
      if (m.kind === 'derived' && !m.expression.trim()) add(`${column.name}: derivation is missing`, column.id);
      if (m.kind === 'external' && !m.externalSource?.trim()) add(`${column.name}: external source location is missing`, column.id);
      if (m.kind === 'external' && m.sources.length) add(`${column.name}: external source also has warehouse inputs`, column.id);
      if (m.kind !== 'external' && !m.sources.some(ref => ref.role !== 'dependency') && !m.noInputs) add(`${column.name}: source dependency not defined`, column.id);
      if (m.noInputs && m.sources.some(ref => ref.role !== 'dependency')) add(`${column.name}: marked independent but has source columns`, column.id);
      if ((m.kind === 'source' || m.kind === 'alias') && m.sources.filter(ref=>ref.role !== 'dependency').length !== 1) add(`${column.name}: copied or aliased columns require exactly one value input`, column.id);
      if (m.noInputs && m.kind !== 'derived') add(`${column.name}: copied columns require a source`, column.id);
      for (const ref of m.sources) {
        const source = nodes.find(n => n.id === ref.tableId);
        if (!source?.columns.some(c => c.id === ref.columnId)) add(`${column.name}: source column no longer exists`, column.id);
        if (!table.upstream.includes(ref.tableId)) add(`${column.name}: source table is not assigned as upstream`, column.id);
      }
    }
  }
  return issues;
}
export function layoutTables(nodes: TableNode[]) {
  if (!nodes.length) return;
  // Stable ordering independent of previous positions and array insertion order.
  const ordered = [...nodes].sort((a,b) => a.id.localeCompare(b.id));
  const levels = new Map<string, number>();
  const level = (id: string, visiting = new Set<string>()): number => {
    if (levels.has(id)) return levels.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parents = ordered.find(n => n.id === id)?.upstream.filter(ref => ordered.some(n => n.id === ref)) ?? [];
    const result = parents.length ? 1 + Math.max(...parents.map(ref => level(ref, new Set(visiting)))) : 0;
    levels.set(id,result); return result;
  };
  type Vertex = { id: string; rank: number; height: number; node?: TableNode; parents: string[]; children: string[]; y: number };
  const vertices = new Map<string,Vertex>();
  for (const node of ordered) vertices.set(node.id, { id:node.id,rank:level(node.id),height:Math.min(300,48 + (node.columns.length ? node.columns.length * 32 + 16 : 0)),node,parents:[],children:[],y:0 });
  // Dummy vertices reserve clear corridors for edges that skip layers.
  for (const node of ordered) for (const parent of [...node.upstream].sort()) {
    if (!vertices.has(parent)) continue;
    let previous = vertices.get(parent)!;
    for (let rank = previous.rank + 1; rank < vertices.get(node.id)!.rank; rank++) {
      const id = `edge:${parent}:${node.id}:${rank}`;
      const dummy: Vertex = { id,rank,height:18,parents:[previous.id],children:[],y:0 };
      previous.children.push(id); vertices.set(id,dummy); previous=dummy;
    }
    previous.children.push(node.id); vertices.get(node.id)!.parents.push(previous.id);
  }
  const ranks: Vertex[][] = [];
  for (const vertex of vertices.values()) (ranks[vertex.rank] ??= []).push(vertex);
  for (let i=0;i<ranks.length;i++) ranks[i] ??= [];
  ranks.forEach(rank => rank.sort((a,b) => a.id.localeCompare(b.id)));
  const positions = () => new Map(ranks.flatMap(rank => rank.map((v,i) => [v.id,i] as const)));
  const crossings = () => {
    const pos=positions(); let count=0;
    for (const rank of ranks) {
      const edges=rank.flatMap(v=>v.children.filter(id=>vertices.get(id)!.rank===v.rank+1).map(id=>[pos.get(v.id)!,pos.get(id)!]));
      for(let i=0;i<edges.length;i++) for(let j=i+1;j<edges.length;j++) if((edges[i][0]-edges[j][0])*(edges[i][1]-edges[j][1])<0) count++;
    }
    return count;
  };
  let best=ranks.map(rank=>[...rank]), score=crossings();
  for(let pass=0;pass<16;pass++) {
    const forward=pass%2===0, sequence=forward?[...ranks.keys()]:[...ranks.keys()].reverse();
    for(const index of sequence) {
      const pos=positions(), prior=new Map(ranks[index].map((v,i)=>[v.id,i]));
      const bary=(v:Vertex) => { const refs=(forward?v.parents:v.children).filter(id=>Math.abs(vertices.get(id)!.rank-v.rank)===1); return refs.length?refs.reduce((sum,id)=>sum+pos.get(id)!,0)/refs.length:prior.get(v.id)!; };
      ranks[index].sort((a,b)=>bary(a)-bary(b)||prior.get(a.id)!-prior.get(b.id)!);
    }
    const next=crossings(); if(next<score) { score=next; best=ranks.map(rank=>[...rank]); }
  }
  ranks.splice(0,ranks.length,...best);
  // Pack without overlap, then relax toward neighbours' header positions.
  for(const rank of ranks) { let y=60; for(const v of rank) { v.y=y; y+=v.height+64; } }
  for(let pass=0;pass<24;pass++) {
    const sequence=pass%2?[...ranks].reverse():ranks;
    for(const rank of sequence) {
      if (!rank.length) continue;
      const desired=rank.map(v=>{const refs=[...v.parents,...v.children];return refs.length?refs.reduce((sum,id)=>sum+vertices.get(id)!.y,0)/refs.length:v.y;});
      for(let i=0;i<rank.length;i++) rank[i].y=Math.max(desired[i],i?rank[i-1].y+rank[i-1].height+64:0);
      // Translate the packed rank toward its desired centre without changing spacing.
      const shift=rank.reduce((sum,v,i)=>sum+desired[i]-v.y,0)/rank.length;
      rank.forEach(v=>v.y+=shift);
    }
  }
  const top=Math.min(...[...vertices.values()].filter(v=>v.node).map(v=>v.y));
  for(const v of vertices.values()) if(v.node) {v.node.x=60+v.rank*440;v.node.y=Math.round(v.y-top+60);}
}
