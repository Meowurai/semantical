import './theme';
import {loadShared,protectReadOnly} from './sharing';
async function start(){
  try {await loadShared();await import('./main');protectReadOnly();}
  catch {document.body.replaceChildren();const message=document.createElement('p');message.textContent='This shared model could not be opened. The link may be incomplete or invalid.';const back=document.createElement('a');back.href=location.pathname;back.textContent='Open my local model';document.body.append(message,back);}
}
void start();
