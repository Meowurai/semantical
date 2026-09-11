import {createElement,Minus,Plus,Scan,LayoutGrid} from 'lucide';

/** Keep canvas navigation identical in both model views. */
export function decorateCanvasControls(controls:HTMLElement){
  const buttons=[...controls.querySelectorAll<HTMLButtonElement>('button')];
  for(const [index,label,icon] of [[0,'Zoom out',Minus],[2,'Zoom in',Plus],[3,'Fit canvas',Scan],[4,'Arrange canvas',LayoutGrid]] as const){
    const button=buttons[index];
    button.replaceChildren(createElement(icon,{width:17,height:17,'aria-hidden':'true','stroke-width':1.5}));
    button.setAttribute('aria-label',label);button.title=label;
  }
  buttons[1].title='Reset zoom to 100%';
  buttons[1].classList.add('canvas-zoom-percentage');
  buttons[3].classList.add('canvas-view-divider');
}
