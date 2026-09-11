import type { ColumnReference, RuleDependency } from './types';
export interface LineageNode { id: string; upstream: string[] }
interface MappedTable extends LineageNode {
  ruleDependencies?: RuleDependency[];
  columns: { id: string; mapping?: { sources: ColumnReference[] } }[];
}
export function columnInputs(table: MappedTable, column: MappedTable['columns'][number]): ColumnReference[] {
  const inputs = [...(column.mapping?.sources ?? []), ...(table.ruleDependencies ?? []).map(ref => ({ ...ref, role: 'dependency' as const }))];
  return inputs.filter((ref,i) => inputs.findIndex(other => other.tableId === ref.tableId && other.columnId === ref.columnId) === i);
}
export const columnRefKey = (tableId: string, columnId: string) => JSON.stringify([tableId, columnId]);
export function upstreamColumns(nodes: MappedTable[], tableId: string, columnId: string, includeDependencies = true): Set<string> {
  const result = new Set<string>();
  const visited = new Set<string>([columnRefKey(tableId, columnId)]);
  const pending = [{ tableId, columnId }];
  while (pending.length) {
    const ref = pending.pop()!;
    const table = nodes.find(node => node.id === ref.tableId);
    const column = table?.columns.find(item => item.id === ref.columnId);
    for (const source of table && column ? columnInputs(table, column) : []) {
      if ((!includeDependencies && source.role === 'dependency') || !table?.upstream.includes(source.tableId)) continue;
      const sourceTable = nodes.find(node => node.id === source.tableId);
      if (!sourceTable?.columns.some(item => item.id === source.columnId)) continue;
      const key = columnRefKey(source.tableId, source.columnId);
      if (visited.has(key)) continue;
      visited.add(key); result.add(key); pending.push(source);
    }
  }
  return result;
}
export function canAddSource(nodes: LineageNode[], targetId: string, sourceId: string): boolean {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const target = byId.get(targetId);
  if (!target || !byId.has(sourceId) || target.upstream.includes(sourceId)) return false;
  const pending = [sourceId], visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === targetId) return false;
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...(byId.get(id)?.upstream ?? []));
  }
  return true;
}
