'use strict';
/* furnitech · редактор · core/history.js
   История (отмена и повтор), применение изменений с проверкой, локальное сохранение. Страница нужна только внутри функций.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ================= История и сохранение ================= */
/* История ограничена и числом шагов, и общим объёмом: проект с вариантами ИИ‑дизайнера занимает сотни килобайт,
   и сто его копий — это уже сотни мегабайт памяти вкладки. */
const HIST_STEPS=100, HIST_CHARS=24e6;
function snapshot(){hist=hist.slice(0,hi+1);hist.push(JSON.stringify(P));let total=0;for(const s of hist)total+=s.length;while(hist.length>HIST_STEPS||(total>HIST_CHARS&&hist.length>2)){total-=hist.shift().length;}hi=hist.length-1;updateButtons();}
/* Что отмена не трогает: это не содержание проекта, а то, как на него сейчас смотрят (вид, единицы, размеры, режим) и его название.
   Иначе «Отменить» внезапно сдвигала план, меняла единицы или возвращала старое название. */
const HIST_KEEP=['viewport','unit','showDims','viewPointsVisible','eyeHeight','panelCollapsed','showAiBadges','name','mode'];
function restore(i){
  if(READONLY)return; const cur=P; P=JSON.parse(hist[i]); for(const k of HIST_KEEP) if(cur[k]!==undefined) P[k]=cur[k];
  if(P.mode==='furniture'&&!P.closed) P.mode='walls'; // мебель расставляется только в замкнутой комнате
  P.updatedAt=new Date().toISOString(); // отмена — тоже изменение: по этой отметке сверяются версии проекта (account.js)
  hi=i; D=derive(P); E.sel=null; E.drag=null; E.activeDim=null;
  /* незавершённое действие могло ссылаться на то, чего в восстановленном проекте нет */
  if(E.mode==='wallStretch'||E.mode==='wallStart'){E.start=null;E.stretch=null;if(P.closed){E.tool='select';E.mode='idle';}else E.mode='wallStart';}
  if(E.mode==='fPlace'&&P.mode!=='furniture'){E.mode='idle';E.fPlace=null;E.fGhost=null;E.tool='select';}
  if(P.mode==='furniture'&&typeof refreshWarnings==='function') refreshWarnings(P);
  save(); if(typeof updateTools==='function')updateTools(); else updateButtons(); render();
}
function undo(){if(hi>0)restore(hi-1);} function redo(){if(hi<hist.length-1)restore(hi+1);}
function apply(fn,opts={}){
  if(READONLY) return READONLY_MSG;
  const Q=JSON.parse(JSON.stringify(P)); const r=fn(Q); if(typeof r==='string') return r;
  const err=validateProject(Q); if(err) return err; delete Q._strict;
  Q.updatedAt=new Date().toISOString(); P=Q; D=derive(P);
  if(!opts.noHist) snapshot(); save(); render(); return null;
}
let saveT=null;
function writeLocal(){saveT=null;if(READONLY)return;if(typeof beforeLocalSave==='function'&&beforeLocalSave()===false)return;let ok=true;try{localStorage.setItem('roomEditor.project',JSON.stringify(P));}catch(e){ok=false;}afterLocalSave(ok);}
function save(){if(READONLY)return;clearTimeout(saveT);saveT=setTimeout(writeLocal,400);}
/* Отложенную запись выполнить сейчас: вкладку закрывают или сворачивают, и последние 0,4 секунды правок не должны пропасть */
function flushSave(){if(saveT==null)return false;clearTimeout(saveT);writeLocal();return true;}
/* afterLocalSave переопределяется в account.js (синхронизация с аккаунтом); там же может быть задан beforeLocalSave():
   false — локальную копию сейчас писать нельзя (в другой вкладке открыт другой проект). */
function afterLocalSave(ok){document.getElementById('saveInd').textContent=ok?'В браузере '+new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}):'Не сохраняется';}
/* Проект при загрузке пришлось очистить от повреждённых элементов (sanitizeProject): прежняя копия остаётся в браузере, пользователь об этом знает */
function reportSanitized(){
  if(!SANITIZED)return; const s=SANITIZED; SANITIZED=null; if(READONLY)return;
  let kept=false; try{if(s.raw){localStorage.setItem('roomEditor.project.backup',s.raw);kept=true;}}catch(e){}
  console.warn('Проект очищен от повреждённых элементов:',s.dropped);
  if(typeof toast==='function')toast(`В проекте нашлись повреждённые элементы (${s.dropped}) — они убраны, чтобы редактор мог работать.`+(kept?' Прежняя копия сохранена в этом браузере.':''),true);
}
function load(){try{const s=localStorage.getItem('roomEditor.project'); if(s){const p=JSON.parse(s); if(p&&p.vertices)return p;}}catch(e){} return null;}
