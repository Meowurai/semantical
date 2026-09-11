export interface SearchableItem {label:string;detail:string;keywords?:string}
export function filterPalette<T extends SearchableItem>(items:T[],query:string):T[]{
  const terms=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if(!terms.length)return items;
  return items.map((item,index)=>{const name=item.label.toLowerCase(),text=`${name} ${item.detail} ${item.keywords??''}`.toLowerCase();const matches=terms.every(term=>text.includes(term));return {item,index,score:matches?terms.reduce((score,term)=>score+(name===term?100:name.startsWith(term)?30:name.includes(term)?10:1),0):-1};}).filter(result=>result.score>=0).sort((a,b)=>b.score-a.score||a.index-b.index).map(result=>result.item);
}
