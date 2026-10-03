'use strict';
/* furnitech · редактор · ui/operations.js
   Операции над стенами и проёмами: создание, длина, удаление.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ================= Операции ================= */
function commitWall(startId,endPt,closeWithId,entered){
  let newId=null;
  const err=apply(Q=>{
    let bId=closeWithId; if(!bId){bId=uid();Q.vertices.push({id:bId,x:Math.round(endPt.x),y:Math.round(endPt.y)});}
    newId=uid(); Q.walls.push({id:newId,a:startId,b:bId,entered});
  });
  if(err){toast(err,true);return null;}
  if(P.closed) onClosed(newId);
  return newId;
}
function onClosed(closingWallId){
  if(P.lengthsIncludeThickness&&P.walls.some(w=>w.entered)) rebuildFromEntered(closingWallId);
  const per=P.walls.reduce((s,w)=>s+D.W.get(w.id).len,0);
  toast(`Контур замкнут. Площадь ${m2(Math.abs(D.area))}, периметр ${fmtU(Math.round(per))}`);
  E.mode='idle'; setTool('select');
}
function rebuildFromEntered(cId){
  const err=apply(Q=>{
    const d=derive(Q); const c=Q.walls.find(w=>w.id===cId); const V=new Map(Q.vertices.map(v=>[v.id,v]));
    const orig=new Map(Q.vertices.map(v=>[v.id,{x:v.x,y:v.y}]));
    let cur=c.b, prevW=c, guard=0;
    while(guard++<Q.walls.length){
      const w=d.adj.get(cur).find(x=>x!==prevW); if(!w||w===c)break;
      const other=w.a===cur?w.b:w.a; const oc=orig.get(cur),oo=orig.get(other); const dx=oo.x-oc.x,dy=oo.y-oc.y,L=Math.hypot(dx,dy);
      const k=(d.convex.get(w.a)?1:0)+(d.convex.get(w.b)?1:0);
      const nl=w.entered?Math.round(w.entered-Q.wallThickness*k):L; if(nl<MIN_WALL) return `Стена после пересчёта с толщиной короче ${fmtU(MIN_WALL)}`;
      const cv=V.get(cur),ov=V.get(other); ov.x=Math.round(cv.x+dx/L*nl); ov.y=Math.round(cv.y+dy/L*nl);
      prevW=w; cur=other; if(cur===c.a)break;
    }
  },{noHist:true});
  if(err) toast('Пересчёт с учётом толщины не выполнен: '+err,true); else snapshot();
}
function setWallLength(wid,newLen){
  return apply(Q=>{
    const d=derive(Q); const w=Q.walls.find(x=>x.id===wid); if(w.locked)return 'Стена зафиксирована. Снимите замок (L)'; if(Q.mode==='furniture')return 'Стены редактируются в режиме стен'; const i=d.W.get(wid); const V=new Map(Q.vertices.map(v=>[v.id,v]));
    const delta=newLen-i.len; const b=V.get(w.b); b.x=Math.round(b.x+i.ux*delta); b.y=Math.round(b.y+i.uy*delta);
    const next=d.adj.get(w.b).find(x=>x!==w);
    if(next&&d.W.get(next.id).ortho){const c=V.get(next.a===w.b?next.b:next.a); c.x=Math.round(c.x+i.ux*delta); c.y=Math.round(c.y+i.uy*delta);}
    if(w.entered!=null) w.entered=Math.round(newLen+Q.wallThickness*kOf(wid,d,Q));
    clampOpenings(Q,derive(Q));
  });
}
function deleteWall(wid){
  const w=P.walls.find(x=>x.id===wid); if(!w)return;
  if(P.mode==='furniture'){toast('Стены удаляются в режиме стен',true);return;}
  if(w.locked){toast('Стена зафиксирована. Снимите замок (L)',true);return;}
  const lo=wallOpenings(wid).filter(o=>o.locked); if(lo.length){toast('Зафиксированы проёмы: '+lo.map(o=>o.name).join(', '),true);return;}
  if(!P.closed&&D.deg.get(w.a)===2&&D.deg.get(w.b)===2){toast('Удалять можно только крайнюю стену незамкнутого контура',true);return;}
  const ops=wallOpenings(wid);
  const go=()=>{ const err=apply(Q=>{Q.walls=Q.walls.filter(x=>x.id!==wid);Q.openings=Q.openings.filter(o=>o.wallId!==wid);Q.furniture=(Q.furniture||[]).filter(f=>f.wallId!==wid);const used=new Set();Q.walls.forEach(x=>{used.add(x.a);used.add(x.b);});Q.vertices=Q.vertices.filter(v=>used.has(v.id));}); if(err)toast(err,true); else {E.sel=null;render();} };
  if(ops.length) confirmDlg('Удалить стену?',`Вместе со стеной удалятся: ${ops.map(o=>o.name).join(', ')}`).then(ok=>{if(ok)go();}); else go();
}
function deleteOpening(id){if(P.mode==='furniture'){toast('Проёмы удаляются в режиме стен',true);return;}if(P.openings.find(o=>o.id===id)?.locked){toast('Объект зафиксирован. Снимите замок (L)',true);return;}const err=apply(Q=>{leaveRow(Q,id);Q.openings=Q.openings.filter(o=>o.id!==id);}); if(err)toast(err,true); else E.sel=null; render();}
async function deleteRow(o){const row=rowOf(o);if(row.some(x=>x.locked)){toast('В ряду есть зафиксированное окно. Снимите замок (L)',true);return;}if(!(await confirmDlg(`Удалить ряд: ${nWin(row.length)}?`,'Будут удалены все окна этого ряда. Отменить можно через Ctrl+Z.')))return;const ids=new Set(row.map(x=>x.id));const err=apply(Q=>{Q.openings=Q.openings.filter(x=>!ids.has(x.id));});if(err)toast(err,true);else{E.sel=null;toast(`Ряд удалён: ${nWin(row.length)}. Ctrl+Z — вернуть`);}render();}
function deleteSelected(){ if(!E.sel)return; if(E.sel.type==='furniture'){deleteFurniture(E.sel.id);return;} if(E.sel.type==='wall')deleteWall(E.sel.id); else if(E.sel.type==='opening')deleteOpening(E.sel.id); else toast('Точка удаляется вместе со стенами'); }
