import type {Box,Point} from './routing';
export function placeLabel(points:Point[],width:number,height:number,obstacles:Box[]){
 const candidates=points.slice(1).flatMap((b,index)=>{const a=points[index];const length=Math.abs(b.x-a.x)+Math.abs(b.y-a.y);return [.5,.25,.75].map(t=>{const x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;const box={id:'label',x:x-width/2,y:y-height/2,width,height};const overlaps=obstacles.reduce((n,r)=>n+Math.max(0,Math.min(box.x+width,r.x+r.width+8)-Math.max(box.x,r.x-8))*Math.max(0,Math.min(box.y+height,r.y+r.height+8)-Math.max(box.y,r.y-8)),0);return {index,t,x,y,box,score:overlaps*100+Math.max(0,width+24-length)*10+(t===.5?0:8)-Math.min(length,500)*.01};});});
 return candidates.sort((a,b)=>a.score-b.score||a.index-b.index||a.t-b.t)[0];
}
