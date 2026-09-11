import { DATA_TYPES, type TableNode } from './types';

export const STORAGE_KEY = 'data-canvas:model:v1';
interface Snapshot { version: 1; zoom?: number; canvasWidth: number; nodes: TableNode[] }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function decodeSnapshot(raw: string): Snapshot {
  const data: unknown = JSON.parse(raw);
  if (!record(data) || data.version !== 1 || !finite(data.canvasWidth) || data.canvasWidth <= 0 || !Array.isArray(data.nodes)) throw new Error('Invalid saved canvas');
  if (data.zoom !== undefined && (!finite(data.zoom) || data.zoom < .2 || data.zoom > 2)) throw new Error('Invalid saved zoom');
  const ids = new Set<string>();
  for (const node of data.nodes) {
    if (!record(node) || typeof node.id !== 'string' || !node.id || ids.has(node.id) ||
      !['name', 'database', 'schema'].every(key => typeof node[key] === 'string') || !finite(node.x) || !finite(node.y) ||
      !Array.isArray(node.columns) || !Array.isArray(node.upstream) || !node.upstream.every(id => typeof id === 'string')) throw new Error('Invalid saved table');
    ids.add(node.id);
    // Older saved canvases predate transformation notes.
    if (node.logic === undefined) node.logic = '';
    if (typeof node.logic !== 'string') throw new Error('Invalid transformation logic');
    if (node.transformation !== undefined && (!record(node.transformation) || !Object.values(node.transformation).every(value => typeof value === 'string'))) throw new Error('Invalid transformation');
    if (node.ruleDependencies !== undefined && (!Array.isArray(node.ruleDependencies) || !node.ruleDependencies.every(ref => record(ref) && typeof ref.tableId === 'string' && typeof ref.columnId === 'string' && ['joins','filters','deduplication','aggregation','loading'].includes(String(ref.rule))))) throw new Error('Invalid rule dependencies');
    const columnIds = new Set<string>();
    for (const column of node.columns) {
      if (!record(column) || typeof column.id !== 'string' || !column.id || columnIds.has(column.id) || typeof column.name !== 'string' ||
        !DATA_TYPES.includes(column.type as typeof DATA_TYPES[number]) || !finite(column.precision) || !Number.isInteger(column.precision) || column.precision < 1 || column.precision > 38 ||
        !finite(column.scale) || !Number.isInteger(column.scale) || column.scale < 0 || column.scale > column.precision) throw new Error('Invalid saved column');
      columnIds.add(column.id);
      if (['primaryKey', 'foreignKey', 'businessKey'].some(key => column[key] !== undefined && typeof column[key] !== 'boolean')) throw new Error('Invalid column key');
      if (column.mapping !== undefined) {
        const mapping = column.mapping;
        if (record(mapping) && mapping.externalSource !== undefined && typeof mapping.externalSource !== 'string') throw new Error('Invalid external source');
        if (record(mapping) && mapping.noInputs !== undefined && typeof mapping.noInputs !== 'boolean') throw new Error('Invalid source dependency');
        if (!record(mapping) || !['source', 'alias', 'derived', 'external'].includes(String(mapping.kind)) || typeof mapping.expression !== 'string' || !Array.isArray(mapping.sources) ||
          !mapping.sources.every(source => record(source) && typeof source.tableId === 'string' && typeof source.columnId === 'string' && (source.role === undefined || ['value', 'dependency'].includes(String(source.role))))) throw new Error('Invalid column mapping');
      }
    }
  }
  for (const node of data.nodes as TableNode[]) {
    if (node.upstream.some(id => !ids.has(id) || id === node.id) || new Set(node.upstream).size !== node.upstream.length) throw new Error('Invalid saved lineage');
  }
  return data as unknown as Snapshot;
}

export function encodeSnapshot(nodes: TableNode[], canvasWidth: number, zoom = 1): string {
  return JSON.stringify({ version: 1, canvasWidth, zoom, nodes } satisfies Snapshot);
}
