'use strict';
/* furnitech · редактор · core/history.js
   История (отмена и повтор), применение изменений с проверкой, локальное сохранение. Страница нужна только внутри функций.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ================= История и сохранение ================= */
function snapshot(){hist=hist.slice(0,hi+1);hist.push(JSON.stringify(P));if(hist.length>100)hist.shift();hi=hist.length-1;updateButtons();}
function restore(i){if(READONLY)return;P=JSON.parse(hist[i]);hi=i;D=derive(P);E.sel=null;save();render();updateButtons();}
function undo(){if(hi>0)restore(hi-1);} function redo(){if(hi<hist.length-1)restore(hi+1);}
function apply(fn,opts={}){
  if(READONLY) return READONLY_MSG;
  const Q=JSON.parse(JSON.stringify(P)); const r=fn(Q); if(typeof r==='string') return r;
  const err=validateProject(Q); if(err) return err; delete Q._strict;
  Q.updatedAt=new Date().toISOString(); P=Q; D=derive(P);
  if(!opts.noHist) snapshot(); save(); render(); return null;
}
let saveT=null;
function save(){if(READONLY)return;clearTimeout(saveT);saveT=setTimeout(()=>{if(READONLY)return;if(typeof beforeLocalSave==='function'&&beforeLocalSave()===false)return;let ok=true;try{localStorage.setItem('roomEditor.project',JSON.stringify(P));}catch(e){ok=false;}afterLocalSave(ok);},400);}
/* afterLocalSave переопределяется в account.js (синхронизация с аккаунтом); там же может быть задан beforeLocalSave():
   false — локальную копию сейчас писать нельзя (в другой вкладке открыт другой проект). */
function afterLocalSave(ok){document.getElementById('saveInd').textContent=ok?'В браузере '+new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}):'Не сохраняется';}
function load(){try{const s=localStorage.getItem('roomEditor.project'); if(s){const p=JSON.parse(s); if(p&&p.vertices)return p;}}catch(e){} return null;}
