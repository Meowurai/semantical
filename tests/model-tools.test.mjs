import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const module = { exports: {} }; cache.set(name, module.exports);
  const code = ts.transpileModule(readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { module, exports: module.exports, crypto: webcrypto, require: path => load(path.replace('./', '')) });
  return module.exports;
}
const { downstreamColumns, validateModel, layoutTables } = load('model-tools');
const { upstreamColumns, columnRefKey } = load('lineage');
const { encodeSnapshot, decodeSnapshot } = load('persistence');
const col = (id, sources = [], kind = 'derived') => ({ id, name: id, type: 'STRING', precision: 18, scale: 2, mapping: { kind, expression: 'rule', sources, noInputs: !sources.length } });
const ref = (tableId, columnId) => ({ tableId, columnId });
const table = (id, upstream, columns) => ({ id, name: id, database: '', schema: '', logic: '', x: 0, y: 0, upstream, columns });
const nodes = [table('a', [], [col('x'), col('other')]), table('b', ['a'], [col('y', [ref('a','x')], 'alias')]), table('c', ['a','b'], [col('z', [ref('a','x'), ref('b','y')])])];
assert.equal(upstreamColumns(nodes, 'c', 'z').size, 2);
assert.equal(downstreamColumns(nodes, 'a', 'x').size, 2);
assert.equal(downstreamColumns(nodes, 'a', 'other').size, 0);
assert.equal(validateModel(nodes).length, 0);
nodes[1].columns[0].mapping.sources.push(ref('missing','gone'));
assert.equal(validateModel(nodes).length, 3);
nodes[1].columns[0].mapping.sources.pop();
nodes[0].columns[0].mapping.expression = '';
assert.equal(validateModel(nodes).length, 1);
nodes[0].columns[0].mapping.expression = 'rule';
layoutTables(nodes);
assert.ok(nodes[0].x < nodes[1].x && nodes[1].x < nodes[2].x);
const offsets = nodes.map(n => [n.x,n.y]); layoutTables(nodes);
assert.equal(JSON.stringify(offsets), JSON.stringify(nodes.map(n => [n.x,n.y])));
nodes[0].transformation = { joins: 'a left join b', loading: 'merge on id' };
const restored = decodeSnapshot(encodeSnapshot(nodes, 1000, .75));
assert.equal(restored.zoom, .75);
assert.equal(restored.nodes[0].transformation.loading, 'merge on id');
assert.equal(restored.nodes[0].columns[0].mapping.noInputs, true);
// Traversal terminates on cyclic imported column references.
nodes[0].upstream = ['c']; nodes[0].columns[0].mapping.sources = [ref('c','z')];
assert.equal(downstreamColumns(nodes,'a','x').size, 2);
assert.ok(!upstreamColumns(nodes,'a','x').has(columnRefKey('a','x')));
console.log('Passed: branching and cyclic traces, missing references, validation, layout, persistence.');
const { companyExample } = load('company-example');
const example = companyExample();
assert.equal(example.length, 12);
assert.equal(validateModel(example).length, 0);
for (const t of example) for (const c of t.columns) for (const r of c.mapping?.sources ?? []) {
  assert.ok(example.find(n => n.id === r.tableId)?.columns.some(n => n.id === r.columnId));
  assert.ok(t.upstream.includes(r.tableId));
}
assert.ok(upstreamColumns(example, 'g_sales', 'net_sales').has(columnRefKey('b_lines', 'unit_price')));
assert.ok(downstreamColumns(example, 'b_customers', 'customer_id').has(columnRefKey('g_ar', 'customer_key')));
console.log('Passed: company example references, validation, and end-to-end traces.');

const { routeEdges, pathHitsBox, roundedPath } = load('routing');
layoutTables(example);
const boxes = example.map(n => ({ id:n.id,x:n.x,y:n.y,width:280,height:Math.min(300,48+(n.columns.length?n.columns.length*32+16:0)) }));
const links = example.flatMap(n=>n.upstream.map(source=>({source,target:n.id})));
const routes = routeEdges(boxes,links);
assert.equal(routes.length, links.length);
for(const route of routes) {
  assert.ok(roundedPath(route.points).startsWith('M '));
  for(const box of boxes) assert.equal(pathHitsBox(route.points,box),false, `${route.source} -> ${route.target} intersects ${box.id}`);
}
for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) {
  const a=boxes[i],b=boxes[j];
  assert.ok(a.x+a.width<=b.x || b.x+b.width<=a.x || a.y+a.height<=b.y || b.y+b.height<=a.y);
}
const blocked = [{id:'a',x:0,y:100,width:280,height:200},{id:'obstacle',x:400,y:0,width:280,height:300},{id:'b',x:800,y:100,width:280,height:200}];
const detour = routeEdges(blocked,[{source:'a',target:'b'}]);
assert.equal(detour.length,1);
assert.equal(pathHitsBox(detour[0].points,blocked[1]),false);
assert.equal(JSON.stringify(routeEdges(boxes,links)),JSON.stringify(routes));
console.log('Passed: non-overlapping arrangement, deterministic routing, skip-layer obstacle avoidance.');

const reversed = companyExample().reverse(); layoutTables(reversed);
assert.equal(JSON.stringify(example.map(n=>[n.id,n.x,n.y]).sort()), JSON.stringify(reversed.map(n=>[n.id,n.x,n.y]).sort()));
layoutTables(nodes); // Cyclic imported graphs must remain finite and not crash.
assert.ok(nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));
const columnRoutes=routeEdges(boxes,[{source:'s_sales',target:'g_sales',sourceY:boxes.find(b=>b.id==='s_sales').y+180,targetY:boxes.find(b=>b.id==='g_sales').y+120}]);
assert.equal(columnRoutes.length,1);
for(const box of boxes) assert.equal(pathHitsBox(columnRoutes[0].points,box),false);

const external = table('external',[],[{id:'status',name:'status',type:'STRING',precision:18,scale:2,mapping:{kind:'external',sources:[],expression:'',externalSource:'ERP.orders.status'}}, col('amount')]);
const filtered = table('filtered',['external'],[col('revenue',[ref('external','amount')],'alias')]);
filtered.ruleDependencies=[{tableId:'external',columnId:'status',rule:'filters'}];
filtered.transformation={filters:"status = 'fulfilled'"};
const ruleModel=[external,filtered];
assert.equal(validateModel(ruleModel).length,0);
assert.ok(upstreamColumns(ruleModel,'filtered','revenue').has(columnRefKey('external','status')));
assert.ok(downstreamColumns(ruleModel,'external','status').has(columnRefKey('filtered','revenue')));
const savedRules=decodeSnapshot(encodeSnapshot(ruleModel,1000));
assert.equal(savedRules.nodes[0].columns[0].mapping.externalSource,'ERP.orders.status');
assert.equal(savedRules.nodes[1].ruleDependencies[0].rule,'filters');
filtered.columns[0].mapping.sources.push({...ref('external','status'),role:'dependency'});
assert.equal(validateModel(ruleModel).length,0);
assert.equal(decodeSnapshot(encodeSnapshot(ruleModel,1000)).nodes[1].columns[0].mapping.sources[1].role,'dependency');
external.columns[0].mapping.externalSource='';
assert.ok(validateModel(ruleModel).some(i=>i.message.includes('external source location')));
const { upgradeCompanyExample }=load('company-example');
const legacy=companyExample();const raw=legacy[0].columns[0];
raw.mapping={kind:'derived',noInputs:true,sources:[],expression:`Ingest ${raw.name} from the ${legacy[0].name} source export without transformation. External source boundary; not generated in the warehouse.`};
legacy[0].x=999; upgradeCompanyExample(legacy);
assert.equal(raw.mapping.kind,'external');assert.equal(legacy[0].x,999);
console.log('Passed: rule-only impact, external boundaries, dependency roles, persistence and safe example upgrade.');
// Value-only tracing stops at dependency branches in both directions.
const scoped = [table('raw', [], [col('value'), col('filter')]), table('clean', ['raw'], [col('result', [ref('raw', 'value')])])];
scoped[1].ruleDependencies = [{...ref('raw', 'filter'), rule:'filters'}];
assert.equal(upstreamColumns(scoped, 'clean', 'result', false).size, 1);
assert.equal(upstreamColumns(scoped, 'clean', 'result', true).size, 2);
assert.equal(downstreamColumns(scoped, 'raw', 'filter', false).size, 0);
assert.equal(downstreamColumns(scoped, 'raw', 'filter', true).size, 1);
assert.equal(downstreamColumns(scoped, 'raw', 'value', false).size, 1);
const { lineCrossings } = load('routing');
const crossings = lineCrossings([[{x:0,y:50},{x:100,y:50}],[{x:50,y:0},{x:50,y:100}]]);
assert.equal(crossings[0].length, 1);
assert.equal(crossings[1].length, 0);
assert.equal(lineCrossings([[{x:0,y:50},{x:100,y:50}],[{x:100,y:50},{x:100,y:100}]])[0].length, 0);
// Incoming table relations converge before one shared header endpoint.
const merged = routeEdges([{id:'one',x:0,y:0,width:100,height:80},{id:'two',x:0,y:200,width:100,height:80},{id:'target',x:400,y:100,width:100,height:80}], [{source:'one',target:'target'},{source:'two',target:'target'}]);
assert.equal(merged.length, 2);
assert.equal(JSON.stringify(merged[0].points.at(-1)), JSON.stringify(merged[1].points.at(-1)));
for (const edge of merged) assert.ok(Math.abs(edge.points.at(-1).x-edge.points.at(-2).x) >= 40);

const { seedBusiness, decodeBusiness, coverage, bindingIssue } = load('business-model');
const business = seedBusiness(example);
assert.equal(business.entities.length, 5);
assert.equal(business.relationships.length, 5);
assert.equal(decodeBusiness(JSON.stringify(business)).entities.length, 5);
for (const entity of business.entities) assert.equal(coverage(entity, example), 'Mapped');
const customerEntity = business.entities.find(e => e.name === 'Customer');
const representation = customerEntity.representations[0];
const customerTable = example.find(t => t.id === representation.tableId);
const attribute = customerEntity.attributes[0];
assert.equal(bindingIssue(attribute, 'missing', customerTable), 'Missing physical column');
assert.match(bindingIssue({...attribute,type:'Number'}, representation.bindings[attribute.id], customerTable), /Type mismatch/);
delete representation.bindings[attribute.id];
assert.equal(coverage(customerEntity, example), 'Partially mapped');
assert.throws(()=>decodeBusiness('{"version":2,"entities":[],"relationships":[]}'));
console.log('Passed: business seed, persistence, mapping coverage, missing columns and incompatible types.');
const {metricIssues} = load('business-model');
const metricModel=seedBusiness(example);
assert.equal(metricModel.metrics.length,1);
const revenue=metricModel.metrics[0];
assert.equal(metricIssues(revenue,metricModel,example).length,0);
assert.equal(decodeBusiness(JSON.stringify(metricModel)).metrics[0].name,'Net revenue');
const legacyBusiness=JSON.parse(JSON.stringify(metricModel));delete legacyBusiness.metrics;
assert.equal(decodeBusiness(JSON.stringify(legacyBusiness)).metrics.length,0);
assert.ok(metricIssues({...revenue,representationId:'missing'},metricModel,example).includes('Choose a physical representation'));
const metricEntity=metricModel.entities.find(e=>e.id===revenue.entityId);
assert.ok(metricIssues({...revenue,attributeId:metricEntity.attributes.find(a=>a.type==='Text').id},metricModel,example).some(i=>i.includes('numeric')));
assert.ok(metricIssues({...revenue,timeAttributeId:revenue.attributeId},metricModel,example).some(i=>i.includes('date')));

// Semantic associations can attach vertically and route around other cards.
const { routeAssociations } = load('routing');
const associationBoxes=[{id:'top',x:100,y:0,width:270,height:160},{id:'bottom',x:100,y:400,width:270,height:160}];
const vertical=routeAssociations(associationBoxes,[{source:'top',target:'bottom'}])[0];
assert.equal(vertical.points[0].y,160);
assert.equal(vertical.points.at(-1).y,400);
assert.equal(vertical.points[0].x,235);
const obstacle={id:'obstacle',x:80,y:230,width:310,height:80};
const diverted=routeAssociations([...associationBoxes,obstacle],[{source:'top',target:'bottom'}])[0];
assert.ok(diverted);
assert.ok(!pathHitsBox(diverted.points,obstacle));
assert.ok(diverted.points.slice(1).every((p,i)=>p.x===diverted.points[i].x||p.y===diverted.points[i].y));

const {arrangeSemantic}=load('semantic-layout');
const semantic=seedBusiness(companyExample());
arrangeSemantic(semantic);
const positions=JSON.stringify([...semantic.entities,...semantic.metrics].map(n=>[n.id,n.x,n.y]));
arrangeSemantic(semantic);
assert.equal(JSON.stringify([...semantic.entities,...semantic.metrics].map(n=>[n.id,n.x,n.y])),positions);
semantic.entities[0].pinned=true;semantic.entities[0].x=257;semantic.entities[0].y=183;
arrangeSemantic(semantic);assert.equal(semantic.entities[0].x,257);assert.equal(semantic.entities[0].y,183);
const semanticCards=[...semantic.entities,...semantic.metrics];
for(let i=0;i<semanticCards.length;i++)for(let j=i+1;j<semanticCards.length;j++){
 const a=semanticCards[i],b=semanticCards[j];const height=n=>n.attributes?48+Math.min(252,16+n.attributes.length*32):170;
 assert.ok(!(a.x<b.x+270&&a.x+270>b.x&&a.y<b.y+height(b)&&a.y+height(a)>b.y));
}
const history=load('history');let physicalState=[{id:'one',x:0,y:0}],semanticState={entities:[{id:'a',attributes:[1],representations:[2]}],relationships:[3]};
history.registerHistory('physical',{read:()=>physicalState,write:v=>physicalState=v});history.registerHistory('business',{read:()=>semanticState,write:v=>semanticState=v});
history.beginHistory();semanticState.entities=[];semanticState.relationships=[];history.commitHistory();history.undo();assert.equal(semanticState.entities[0].attributes[0],1);assert.equal(semanticState.relationships[0],3);history.redo();assert.equal(semanticState.entities.length,0);
history.beginHistory();physicalState[0].x=100;physicalState[0].y=200;history.commitHistory();history.undo();assert.equal(semanticState.entities.length,1);
console.log('Passed: semantic arrangement, pinned positions, shared undo/redo, and navigation excluded from history.');

const {placeLabel}=load('label-layout');
const labelRoute=[{x:0,y:0},{x:400,y:0},{x:400,y:400}];
const occupied=[{id:'card',x:120,y:-50,width:160,height:100}];
const labelOne=placeLabel(labelRoute,100,30,occupied);
assert.ok(labelOne.box.y>=50||labelOne.box.x+100<=120||labelOne.box.x>=280);
const labelTwo=placeLabel(labelRoute,100,30,[...occupied,labelOne.box]);
assert.ok(labelOne.x!==labelTwo.x||labelOne.y!==labelTwo.y);

// Multiple text inputs form one transaction; cross-model edits restore complete snapshots.
let projectTables=companyExample(),projectBusiness=seedBusiness(projectTables);
history.registerHistory('physical',{read:()=>projectTables,write:v=>projectTables=v});
history.registerHistory('business',{read:()=>projectBusiness,write:v=>projectBusiness=v});
const initialProject=JSON.stringify({projectTables,projectBusiness});
history.beginHistory();projectBusiness.entities[0].name='C';projectBusiness.entities[0].name='Customer renamed';history.commitHistory();
const renamedProject=JSON.stringify({projectTables,projectBusiness});
history.beginHistory();delete projectBusiness.entities[0].representations[0].bindings[projectBusiness.entities[0].attributes[0].id];history.commitHistory();
const remappedProject=JSON.stringify({projectTables,projectBusiness});
history.beginHistory();history.recordPositionChange();projectTables[0].x+=110;projectTables[0].y+=30;history.commitHistory();
const movedProject=JSON.stringify({projectTables,projectBusiness});
history.beginHistory();const deletedId=projectBusiness.entities[0].id;projectBusiness.entities.shift();projectBusiness.relationships=projectBusiness.relationships.filter(r=>r.from!==deletedId&&r.to!==deletedId);history.commitHistory();
history.undo();assert.equal(JSON.stringify({projectTables,projectBusiness}),movedProject);
history.undo();assert.equal(JSON.stringify({projectTables,projectBusiness}),remappedProject);
history.undo();assert.equal(JSON.stringify({projectTables,projectBusiness}),renamedProject);
history.undo();assert.equal(JSON.stringify({projectTables,projectBusiness}),initialProject);
history.redo();history.redo();history.redo();assert.equal(JSON.stringify({projectTables,projectBusiness}),movedProject);
history.undo();history.beginHistory();projectBusiness.entities[0].definition='New branch';history.commitHistory();assert.equal(history.historyState().redo,false);
console.log('Passed: label collision avoidance and mixed typing, mapping, dragging, deletion, undo/redo and branching histories.');
// Larger semantic model remains deterministic with mixed card heights and disconnected nodes.
const large=seedBusiness(companyExample());
for(let i=0;i<15;i++){const copy=structuredClone(large.entities[i%5]);copy.id='extra-'+i;copy.name='Extra '+i;copy.attributes=copy.attributes.slice(0,1+i%5);large.entities.push(copy);large.relationships.push({id:'link-'+i,from:large.entities[i%5].id,to:copy.id,name:'relates',cardinality:'One to many',optional:false});}
arrangeSemantic(large);const largePositions=JSON.stringify(large.entities.map(n=>[n.x,n.y]));arrangeSemantic(large);assert.equal(JSON.stringify(large.entities.map(n=>[n.x,n.y])),largePositions);
for(let i=0;i<large.entities.length;i++)for(let j=i+1;j<large.entities.length;j++){const a=large.entities[i],b=large.entities[j];assert.ok(Math.abs(a.x-b.x)>=270||Math.abs(a.y-b.y)>=300);}

// Model files preserve both layers and reject malformed/unsupported imports.
const {encodeModelFile,decodeModelFile}=load('model-file');
const semanticFile={version:1,entities:[],relationships:[],metrics:[]};
const fileText=encodeModelFile(encodeSnapshot(nodes,1200),semanticFile);
const fileModel=decodeModelFile(fileText);
assert.equal(JSON.stringify(fileModel.lineage.nodes),JSON.stringify(nodes));
assert.equal(JSON.stringify(fileModel.semantics),JSON.stringify(semanticFile));
assert.throws(()=>decodeModelFile('{'));
assert.throws(()=>decodeModelFile(JSON.stringify({...fileModel,version:2})));
assert.throws(()=>decodeModelFile(JSON.stringify({...fileModel,lineage:{version:1,nodes:[]}})));
assert.throws(()=>decodeModelFile(JSON.stringify({...fileModel,semantics:{version:1,entities:[{}],relationships:[]}})));
console.log('Model file round-trip and invalid-file checks passed.');

const fullTables=companyExample(),fullBusiness=seedBusiness(fullTables);
const fullModel=decodeModelFile(encodeModelFile(encodeSnapshot(fullTables,1266),fullBusiness));
assert.equal(JSON.stringify(fullModel.semantics),JSON.stringify(fullBusiness));
assert.equal(JSON.stringify(fullModel.lineage.nodes),JSON.stringify(fullTables));
