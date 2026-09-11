export interface Point { x:number; y:number }
export interface Box { id:string; x:number; y:number; width:number; height:number }
export interface RoutedEdge { source:string; target:string; points:Point[] }
const intersects = (a:Point,b:Point,r:Box) => a.x===b.x
  ? a.x>r.x && a.x<r.x+r.width && Math.max(a.y,b.y)>r.y && Math.min(a.y,b.y)<r.y+r.height
  : a.y>r.y && a.y<r.y+r.height && Math.max(a.x,b.x)>r.x && Math.min(a.x,b.x)<r.x+r.width;
export const pathHitsBox = (points:Point[],box:Box) => points.slice(1).some((p,i)=>intersects(points[i],p,box));

// Rectilinear visibility grid. Costs favour short paths with few bends, and
// discourage sharing a corridor with another edge. Card clearance is mandatory.
function route(start:Point,end:Point,boxes:Box[],used:Map<string,number>):Point[] {
  const expanded=boxes.map(b=>({...b,x:b.x-12,y:b.y-12,width:b.width+24,height:b.height+24}));
  const xs=[...new Set([start.x,end.x,...expanded.flatMap(b=>[b.x-4,b.x+b.width+4])])].sort((a,b)=>a-b);
  const ys=[...new Set([start.y,end.y,...expanded.flatMap(b=>[b.y-4,b.y+b.height+4])])].sort((a,b)=>a-b);
  const nx=xs.length, total=nx*ys.length;
  const point=(id:number):Point=>({x:xs[id%nx],y:ys[Math.floor(id/nx)]});
  const from=ys.indexOf(start.y)*nx+xs.indexOf(start.x), to=ys.indexOf(end.y)*nx+xs.indexOf(end.x);
  const distance=new Float64Array(total*3).fill(Infinity), previous=new Int32Array(total*3).fill(-1);
  const heap:{state:number;cost:number}[]=[];
  const push=(entry:{state:number;cost:number})=>{heap.push(entry);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p].cost<=entry.cost)break;heap[i]=heap[p];i=p;}heap[i]=entry;};
  const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].cost<heap[c].cost)c++;if(last.cost<=heap[c].cost)break;heap[i]=heap[c];i=c;}heap[i]=last;}return first;};
  const segmentKey=(a:Point,b:Point)=>[a.x,a.y,b.x,b.y].join(',');
  distance[from*3]=0;push({state:from*3,cost:0}); let finish=-1;
  const clear=new Map<string,boolean>();
  while(heap.length){
    const {state,cost}=pop();if(cost!==distance[state])continue;
    const id=Math.floor(state/3),dir=state%3;if(id===to){finish=state;break;}
    const a=point(id), x=id%nx, y=Math.floor(id/nx);
    for(const [next,nextDir] of [[x? id-1:-1,1],[x<nx-1?id+1:-1,1],[y?id-nx:-1,2],[y<ys.length-1?id+nx:-1,2]]){
      if(next<0)continue;const b=point(next), key=segmentKey(a,b);
      if(!clear.has(key))clear.set(key,!expanded.some(r=>intersects(a,b,r)));
      if(!clear.get(key))continue;
      const length=Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
      const shared=used.get(key)??used.get(segmentKey(b,a))??0;
      const candidate=cost+length+(dir&&dir!==nextDir?28:0)+shared*20;
      const nextState=next*3+nextDir;
      if(candidate<distance[nextState]){distance[nextState]=candidate;previous[nextState]=state;push({state:nextState,cost:candidate});}
    }
  }
  if(finish<0)return []; // Overlapping manually placed cards may have no clear exit.
  const points:Point[]=[];for(let state=finish;state>=0;state=previous[state])points.push(point(Math.floor(state/3)));points.reverse();
  for(let i=1;i<points.length;i++){const key=segmentKey(points[i-1],points[i]);used.set(key,(used.get(key)??0)+1);}
  return points.filter((p,i)=>!i||i===points.length-1||!((points[i-1].x===p.x&&p.x===points[i+1].x)||(points[i-1].y===p.y&&p.y===points[i+1].y)));
}
export function routeEdges(boxes:Box[],links:{source:string;target:string;sourceY?:number;targetY?:number}[]):RoutedEdge[] {
  const byId=new Map(boxes.map(b=>[b.id,b])),used=new Map<string,number>();
  const sorted=[...links].sort((a,b)=>a.source.localeCompare(b.source)||a.target.localeCompare(b.target));
  return sorted.flatMap(link=>{
    const a=byId.get(link.source),b=byId.get(link.target);if(!a||!b)return [];
    const forward=b.x>=a.x+a.width;
    const outgoing=sorted.filter(e=>e.source===a.id).sort((u,v)=>byId.get(u.target)!.y-byId.get(v.target)!.y||u.target.localeCompare(v.target));
    const port=(i:number,n:number)=>12+(i+1)*24/(n+1);
    const start={x:forward?a.x+a.width+18:a.x-18,y:link.sourceY ?? a.y+port(outgoing.indexOf(link),outgoing.length)};
    // Table relations share one header port and a longer straight approach.
    // Column relations retain their individual row endpoints.
    const approach = link.targetY === undefined ? 48 : 18;
    const endpoint = {x:forward?b.x-7:b.x+b.width+7, y:link.targetY ?? b.y+24};
    let end={x:forward?b.x-approach:b.x+b.width+approach,y:endpoint.y};
    if (boxes.some(box => box.id !== b.id && intersects(end, endpoint, box))) {
      end = {x:forward?b.x-18:b.x+b.width+18,y:endpoint.y};
    }
    const middle=route(start,end,boxes,used);
    if(!middle.length)return [];
    return [{...link,points:[{x:start.x+(forward?-16:16),y:start.y},...middle,endpoint]}];
  });
}
// Semantic associations have no fixed flow direction: evaluate all four card sides.
export function routeAssociations(boxes:Box[],links:{source:string;target:string}[]):RoutedEdge[] {
  const byId=new Map(boxes.map(b=>[b.id,b]));
  const previous:Point[][]=[];
  const ports=(b:Box)=>[
    {p:{x:b.x,y:b.y+b.height/2},d:{x:-1,y:0}},
    {p:{x:b.x+b.width,y:b.y+b.height/2},d:{x:1,y:0}},
    {p:{x:b.x+b.width/2,y:b.y},d:{x:0,y:-1}},
    {p:{x:b.x+b.width/2,y:b.y+b.height},d:{x:0,y:1}}
  ];
  return links.flatMap(link=>{
    const a=byId.get(link.source),b=byId.get(link.target);if(!a||!b)return [];
    let best:Point[]=[];let cost=Infinity;
    for(const from of ports(a))for(const to of ports(b)){
      const start={x:from.p.x+from.d.x*24,y:from.p.y+from.d.y*24};
      const end={x:to.p.x+to.d.x*24,y:to.p.y+to.d.y*24};
      if(boxes.some(box=>box.id!==a.id&&pathHitsBox([from.p,start],box)||box.id!==b.id&&pathHitsBox([end,to.p],box)))continue;
      const middle=route(start,end,boxes,new Map());if(!middle.length)continue;
      const points=[from.p,...middle,to.p];
      const clean=points.filter((p,i)=>!i||i===points.length-1||!((points[i-1].x===p.x&&p.x===points[i+1].x)||(points[i-1].y===p.y&&p.y===points[i+1].y)));
      let score=clean.slice(1).reduce((n,p,i)=>n+Math.abs(p.x-clean[i].x)+Math.abs(p.y-clean[i].y),0)+(clean.length-2)*32;
      for(const path of previous)for(let i=1;i<clean.length;i++)for(let j=1;j<path.length;j++){
        const a=clean[i-1],b=clean[i],c=path[j-1],d=path[j];
        const horizontal=a.y===b.y,otherHorizontal=c.y===d.y;
        if(horizontal!==otherHorizontal){const h=horizontal?[a,b]:[c,d],v=horizontal?[c,d]:[a,b];if(v[0].x>Math.min(h[0].x,h[1].x)&&v[0].x<Math.max(h[0].x,h[1].x)&&h[0].y>Math.min(v[0].y,v[1].y)&&h[0].y<Math.max(v[0].y,v[1].y))score+=140;}
        else if(horizontal?a.y===c.y:a.x===c.x){const overlap=horizontal?Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))-Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x)):Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))-Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y));if(overlap>0)score+=overlap*.8;}
      }
      if(score<cost){cost=score;best=clean;}
    }
    if(best.length)previous.push(best);
    return best.length?[{...link,points:best}]:[];
  });
}
export function roundedPath(points:Point[],radius=6):string {
  if(!points.length)return '';
  let d=`M ${points[0].x} ${points[0].y}`;
  for(let i=1;i<points.length-1;i++){
    const a=points[i-1],b=points[i],c=points[i+1];
    const ab=Math.hypot(b.x-a.x,b.y-a.y),bc=Math.hypot(c.x-b.x,c.y-b.y),r=Math.min(radius,ab/2,bc/2);
    if(!ab||!bc)continue;
    const p={x:b.x+(a.x-b.x)*r/ab,y:b.y+(a.y-b.y)*r/ab},q={x:b.x+(c.x-b.x)*r/bc,y:b.y+(c.y-b.y)*r/bc};
    d+=` L ${p.x} ${p.y} Q ${b.x} ${b.y} ${q.x} ${q.y}`;
  }
  const last=points.at(-1)!;return d+` L ${last.x} ${last.y}`;
}

// Only strict perpendicular crossings count; shared ports and bends are not junctions.
export function lineCrossings(paths: Point[][], clearance = 12): Point[][] {
  return paths.map((points, index) => {
    const crossings: Point[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i-1], b = points[i];
      if (a.y !== b.y) continue;
      for (let j = 0; j < paths.length; j++) {
        if (j === index) continue;
        for (let k = 1; k < paths[j].length; k++) {
          const c = paths[j][k-1], d = paths[j][k];
          if (c.x !== d.x || c.x <= Math.min(a.x,b.x)+clearance || c.x >= Math.max(a.x,b.x)-clearance || a.y <= Math.min(c.y,d.y)+clearance || a.y >= Math.max(c.y,d.y)-clearance) continue;
          if (!crossings.some(p => p.y === a.y && Math.abs(p.x-c.x) < clearance*2)) crossings.push({x:c.x,y:a.y});
        }
      }
    }
    return crossings;
  });
}
