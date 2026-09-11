import type {BusinessModel} from './business-model';
export function arrangeSemantic(model:BusinessModel){
 const all=[...model.entities,...model.metrics];
 const links=[...model.relationships.map(r=>({a:r.from,b:r.to,weight:1})),...model.metrics.map(m=>({a:m.entityId,b:m.id,weight:3}))];
 const degree=(id:string)=>links.filter(l=>l.a===id||l.b===id).reduce((n,l)=>n+l.weight,0);
 const placed=all.filter(n=>n.pinned);
 const height=(n:typeof all[number])=>'attributes' in n?48+Math.min(252,16+n.attributes.length*32):170;
 const overlap=(x:number,y:number,n:typeof all[number])=>placed.some(p=>x<p.x+310&&x+310>p.x&&y<p.y+height(p)+70&&y+height(n)+70>p.y);
 const pending=all.filter(n=>!n.pinned).sort((a,b)=>degree(b.id)-degree(a.id)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
 const cells:{x:number;y:number}[]=[];const size=Math.max(4,Math.ceil(Math.sqrt(all.length))*2);
 for(let row=0;row<size;row++)for(let col=0;col<size;col++)cells.push({x:80+col*420,y:110+row*390});
 while(pending.length){
   pending.sort((a,b)=>{
     const linked=(id:string)=>links.filter(l=>(l.a===id&&placed.some(p=>p.id===l.b))||(l.b===id&&placed.some(p=>p.id===l.a))).reduce((n,l)=>n+l.weight,0);
     return linked(b.id)-linked(a.id)||degree(b.id)-degree(a.id)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id);
   });
   const node=pending.shift()!;
   const score=(c:{x:number;y:number})=>links.reduce((n,l)=>{const other=l.a===node.id?l.b:l.b===node.id?l.a:'';const p=placed.find(p=>p.id===other);return n+(p?Math.hypot(c.x-p.x,c.y-p.y)*l.weight:0);},0)+Math.hypot(c.x-500,c.y-500)*.12;
   const candidate=cells.filter(c=>!overlap(c.x,c.y,node)).sort((a,b)=>score(a)-score(b)||a.y-b.y||a.x-b.x)[0];
   node.x=candidate?.x??80;node.y=candidate?.y??Math.max(110,...placed.map(p=>p.y+height(p)+100));placed.push(node);
 }
}
