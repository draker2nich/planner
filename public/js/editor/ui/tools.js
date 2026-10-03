'use strict';
/* furnitech · редактор · ui/tools.js
   Инструменты и режимы, клик, перетаскивание, клавиатура и указатель.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ================= Инструменты и режимы ================= */
async function setTool(t){
  if(READONLY&&t!=='select'){toast(READONLY_MSG);return;}
  if(P.mode==='furniture'&&t!=='select'){toast('Стены и проёмы редактируются в режиме стен');return;}
  if(t==='wall'&&P.closed){toast('Контур замкнут. Удалите стену, чтобы изменить контур');return;}
  E.tool=t; E.mode='idle'; E.start=null; E.stretch=null; E.ghost=null; E.openParams=null; E.copyMode=false;
  if(t==='wall'){
    if(!P.wallParamsSet){const r=await wallParamsDialog(); if(!r){E.tool='select';updateTools();render();return;} const err=apply(Q=>{Object.assign(Q,r);Q.wallParamsSet=true;}); if(err){toast(err,true);} }
    E.mode='wallStart'; E.sel=null;
  } else if(t==='door'||t==='window'||t==='arch'){
    if(!P.walls.length){toast('Сначала нарисуйте стену',true);E.tool='select';updateTools();return;}
    const r=await openingDialog(t); if(!r){E.tool='select';updateTools();render();return;}
    E.openParams=r; E.mode='openingPlace'; E.sel=null;
  }
  updateTools(); render();
}
function updateTools(){
  document.querySelectorAll('#tools [data-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.tool===E.tool);b.setAttribute('aria-pressed',String(b.dataset.tool===E.tool)); if(b.dataset.tool==='wall'){b.disabled=P.closed;b.title=P.closed?'Контур замкнут. Удалите стену, чтобы изменить контур':'Стена (W)';}});
  document.querySelectorAll('[data-view=dims]').forEach(b=>b.classList.toggle('on',P.showDims)); document.querySelectorAll('[data-view=points]').forEach(b=>{b.classList.toggle('on',P.closed&&P.viewPointsVisible);b.disabled=!P.closed;}); document.querySelectorAll('[data-view=ai]').forEach(b=>b.classList.toggle('on',!!P.showAiBadges)); updateButtons(); if(typeof updateModeUI==='function')updateModeUI();
}
function updateButtons(){document.querySelectorAll('[data-view=undo]').forEach(b=>b.disabled=hi<=0);document.querySelectorAll('[data-view=redo]').forEach(b=>b.disabled=hi>=hist.length-1);}

function vertexNear(sp,excl){let best=null,bd=SNAP_R;for(const v of P.vertices){if(v.id===excl)continue;const d=hyp(sub(S(v),sp));if(d<=bd){bd=d;best=v;}}return best;}
function nearestWall(wp){let best=null,bd=Infinity;for(const w of P.walls){const i=D.W.get(w.id);const d=distPtSeg(wp,i.a,i.b)*vp().zoom;if(d<bd){bd=d;best=i;}}return best&&bd<=SNAP_R?best:null;}
function wallAtScreen(sp){let best=null,bd=Infinity;const wp=Wd(sp);for(const w of P.walls){const i=D.W.get(w.id);const off=wp.x*i.nx+wp.y*i.ny-(i.a.x*i.nx+i.a.y*i.ny);const along=dot(sub(wp,i.a),{x:i.ux,y:i.uy});let d;if(along>=0&&along<=i.len&&off>=-6/vp().zoom&&off<=P.wallThickness+6/vp().zoom)d=0;else d=distPtSeg(wp,i.a,i.b)*vp().zoom;if(d<bd){bd=d;best=i;}}return best&&bd<=8?best:null;}
function openingAtScreen(sp){const wp=Wd(sp);for(const o of P.openings){const i=D.W.get(o.wallId);const along=dot(sub(wp,i.ref),{x:i.rx,y:i.ry});const off=dot(sub(wp,i.ref),{x:i.nx,y:i.ny});const pad=6/vp().zoom;if(along>=o.offset-pad&&along<=o.offset+o.width+pad&&off>=-pad&&off<=P.wallThickness+pad)return o;}return null;}
function hitTest(sp){
  for(const hh of E.dimHits) if(sp.x>=hh.rect.x&&sp.x<=hh.rect.x+hh.rect.w&&sp.y>=hh.rect.y&&sp.y<=hh.rect.y+hh.rect.h) return {type:'dim',item:hh.item};
  const vpt=viewPointAtScreen(sp); if(vpt)return {type:'viewpoint',id:vpt.index};
  const fu=furnitureAtScreen(sp); if(fu)return {type:'furniture',id:fu.id};
  const o=openingAtScreen(sp); if(o)return {type:'opening',id:o.id};
  const v=vertexNear(sp); if(v)return {type:'vertex',id:v.id};
  const w=wallAtScreen(sp); if(w)return {type:'wall',id:w.w.id};
  if(P.closed&&pointInPoly(Wd(sp),innerPoly()))return {type:'floor'};
  return null;
}
function computeStretch(startV,cw){
  const sp=S(cw); const near=vertexNear(sp,startV.id); const free=freeVertices();
  if(near&&D.deg.get(near.id)===1&&free.length===2) return {mode:'diag',end:near,len:hyp(sub(near,startV))};
  const blocked=near&&D.deg.get(near.id)>=2?near:null;
  const dx=cw.x-startV.x,dy=cw.y-startV.y; const horiz=Math.abs(dx)>=Math.abs(dy);
  const dirx=horiz?Math.sign(dx)||1:0, diry=horiz?0:Math.sign(dy)||1; let len=Math.abs(horiz?dx:dy); let guide=null;
  for(const v of P.vertices){ if(v.id===startV.id)continue; const L=horiz?(v.x-startV.x)*dirx:(v.y-startV.y)*diry; if(L>MIN_WALL-1&&Math.abs(L-len)*vp().zoom<=SNAP_R&&(!guide||Math.abs(L-len)<Math.abs(guide.L-len))){guide={v,L};} }
  if(guide) len=guide.L;
  const end={x:startV.x+dirx*len,y:startV.y+diry*len};
  const closes=free.find(v=>v.id!==startV.id&&Math.abs(v.x-end.x)<1&&Math.abs(v.y-end.y)<1)||null;
  return {mode:'ortho',dirx,diry,len,end,guide:guide?guide.v:null,closes,blocked};
}
function computeGhost(cw){
  const info=nearestWall(cw); if(!info)return null; const p=E.openParams;
  if(p.count>1){
    const n=p.count, w=p.width, proj=dot(sub(cw,info.ref),{x:info.rx,y:info.ry});
    if(p.layout==='even'){
      const ev=evenOffsets(info.len,n,w);
      if(ev.gap<MIN_PIER-0.5) return {info,invalid:`${nWin(n)} по ${fmtU(w)} не помещаются на стене ${fmtU(Math.round(info.len))}`};
      const hit=wallOpenings(info.w.id).find(q=>ev.offs.some(o=>o<q.offset+q.width-0.5&&q.offset<o+w-0.5));
      if(hit) return {info,invalid:`Мешает ${hit.name} — уберите его или выберите расстановку «С простенком»`,offs:ev.offs};
      return {info,offs:ev.offs,gap:Math.round(ev.gap)};
    }
    const sp=n*w+(n-1)*p.gap;
    if(info.len<sp-0.5) return {info,invalid:`Ряд шириной ${fmtU(Math.round(sp))} длиннее стены`};
    const off=fitOffset(info,sp,proj-sp/2,null); if(off===null) return {info,invalid:'Нет места для ряда между проёмами'};
    return {info,offs:gapOffsets(off,n,w,p.gap),gap:p.gap};
  }
  if(info.len<p.width-0.5) return {info,invalid:'Стена короче проёма'};
  const proj=dot(sub(cw,info.ref),{x:info.rx,y:info.ry}); const off=fitOffset(info,p.width,proj-p.width/2,null);
  if(off===null) return {info,invalid:'Нет места между проёмами'};
  return {info,offset:off};
}
function newOpeningName(kind){P.seq=P.seq||{door:0,window:0,arch:0};return `${KIND_NAME[kind]} ${(P.seq[kind]||0)+1}`;}

async function onClick(sp){
  const cw=Wd(sp);
  if(E.mode==='idle'){
    const hit=hitTest(sp);
    if(!hit){E.sel=null;E.propsOpen=false;render();return;}
    if(hit.type==='dim'){await editDim(hit.item);return;}
    if(hit.type==='viewpoint'){enter3D(hit.id);return;}
    if(hit.type==='floor'){E.sel={type:'floor'};render();return;}
    const same=E.sel&&E.sel.type===hit.type&&E.sel.id===hit.id; if(same){E.propsOpen=true;} else {E.sel={type:hit.type,id:hit.id};E.propsOpen=false;} render(); return;
  }
  if(E.mode==='fPlace'){await placeFurnitureClick(cw);return;}
  if(E.mode==='wallStart'){
    if(!P.vertices.length){ const id=uid(); const err=apply(Q=>{Q.vertices.push({id,x:Math.round(cw.x),y:Math.round(cw.y)});},{noHist:true}); if(err)return toast(err,true); E.start=P.vertices.find(v=>v.id===id); E.mode='wallStretch'; render(); return; }
    const v=vertexNear(sp);
    if(v&&D.deg.get(v.id)===1){E.start=v;E.mode='wallStretch';E.stretch=computeStretch(v,cw);render();return;}
    if(v){toast('Нельзя присоединить: точка уже соединяет две стены',true);return;}
    E.hintUntil=Date.now()+1000; toast('Продолжите контур от свободной точки'); render(); return;
  }
  if(E.mode==='wallStretch'){
    const st=computeStretch(E.start,cw); E.stretch=st;
    if(st.mode==='diag'){
      if(st.len<MIN_WALL)return toast(`Стена короче ${fmtU(MIN_WALL)}`,true);
      const id=commitWall(E.start.id,null,st.end.id); if(id){const ang=Math.round(Math.atan2(st.end.y-E.start.y,st.end.x-E.start.x)*180/Math.PI*10)/10; toast(`Длина ${fmtU(Math.round(st.len))}, угол ${ang}°`);} render(); return;
    }
    if(st.blocked){toast('Нельзя присоединить: точка уже соединяет две стены',true);return;}
    if(st.closes){
      const r=await lengthDialog(Math.round(st.len),{closing:true}); if(!r){render();return;}
      commitWall(E.start.id,null,st.closes.id); render(); return;
    }
    const start=E.start; const prefill=Math.max(MIN_WALL,Math.round(st.len/10)*10);
    E.activeDim={type:'temp'};
    const r=await lengthDialog(P.lengthsIncludeThickness?prefill+2*P.wallThickness:prefill,{validate:(len)=>{
      const end={x:start.x+st.dirx*len,y:start.y+st.diry*len}; const Q=JSON.parse(JSON.stringify(P)); const bId=uid(); Q.vertices.push({id:bId,...end}); Q.walls.push({id:uid(),a:start.id,b:bId}); return validateProject(Q);}});
    E.activeDim=null;
    if(!r){render();return;}
    const end={x:start.x+st.dirx*r.len,y:start.y+st.diry*r.len};
    const closeV=freeVertices().find(v=>v.id!==start.id&&Math.abs(v.x-end.x)<1&&Math.abs(v.y-end.y)<1);
    const id=commitWall(start.id,end,closeV?closeV.id:null,r.entered);
    if(id&&!P.closed){const w=P.walls.find(x=>x.id===id); E.start=D.V.get(w.b); E.mode='wallStretch'; E.stretch=null;}
    if(!id&&P.vertices.length===1&&!P.walls.length){/* первая точка осталась */}
    render(); return;
  }
  if(E.mode==='openingPlace'){
    const g=computeGhost(cw); if(!g||g.invalid){if(g)toast(g.invalid,true);return;}
    const p=E.openParams; const kind=p.kind;
    if(p.count>1&&g.offs){ await placeRow(p,g); return; }
    const id=uid(); const name=p.name||newOpeningName(kind);
    const o={id,kind,name,wallId:g.info.w.id,offset:g.offset,width:p.width,height:p.height,sill:p.sill,head:p.head,radius:p.radius,hinge:p.hinge||'left',swing:p.swing||'in'};
    const err=apply(Q=>{Q.openings.push(o);Q.seq=Q.seq||{door:0,window:0,arch:0};if(!p.name)Q.seq[kind]=(Q.seq[kind]||0)+1;},{noHist:true}); if(err)return toast(err,true);
    E.sel={type:'opening',id}; E.activeDim={type:'opening',id}; render();
    const r=await positionDialog(P.openings.find(x=>x.id===id));
    E.activeDim=null;
    if(!r){ apply(Q=>{Q.openings=Q.openings.filter(x=>x.id!==id);if(!p.name)Q.seq[kind]--;},{noHist:true}); E.sel=null; }
    else { const e2=apply(Q=>{Q.openings.find(x=>x.id===id).offset=r.offset;}); if(e2)toast(e2,true); }
    if(E.copyMode){ E.mode='openingPlace'; E.sel=null; E.ghost=null; }
    else { E.tool='select'; E.mode='idle'; E.openParams=null; E.ghost=null; }
    updateTools(); render(); return;
  }
}
async function placeRow(p,g){
  const n=g.offs.length, gid=uid(), wallId=g.info.w.id; const base=(P.seq&&P.seq.window)||0;
  const ops=g.offs.map((off,k)=>({id:uid(),kind:'window',name:`${KIND_NAME.window} ${base+k+1}`,wallId,offset:off,width:p.width,height:p.height,sill:p.sill,head:p.head,hinge:'left',swing:'in',group:gid,groupLayout:p.layout}));
  const ids=new Set(ops.map(o=>o.id));
  const finish=()=>{ if(E.copyMode){E.mode='openingPlace';E.ghost=null;} else {E.tool='select';E.mode='idle';E.openParams=null;E.ghost=null;} updateTools(); render(); };
  if(p.layout==='even'){
    const err=apply(Q=>{Q.openings.push(...ops);Q.seq=Q.seq||{door:0,window:0,arch:0};Q.seq.window=base+n;});
    if(err){toast(err,true);return;}
    E.sel={type:'opening',id:ops[0].id}; toast(`${nWin(n)} в ряд: простенки по ${fmtU(g.gap)}`); finish(); return;
  }
  const err=apply(Q=>{Q.openings.push(...ops);Q.seq=Q.seq||{door:0,window:0,arch:0};Q.seq.window=base+n;},{noHist:true}); if(err){toast(err,true);return;}
  E.sel={type:'opening',id:ops[0].id}; E.activeDim={type:'opening',id:ops[0].id}; render();
  const row=P.openings.filter(x=>ids.has(x.id)).sort((a,b)=>a.offset-b.offset);
  const r=await rowPositionDialog(row,row[0].offset,{gap:p.gap}); E.activeDim=null;
  if(!r){ apply(Q=>{Q.openings=Q.openings.filter(x=>!ids.has(x.id));Q.seq.window=base;},{noHist:true}); E.sel=null; }
  else { const e2=apply(Q=>relayoutRow(Q,gid,{start:r.start,gap:r.gap})); if(e2)toast(e2,true); }
  finish();
}
function copyOpening(o){const row=rowOf(o);if(o.kind==='window'&&row.length>1){const g=rowUniformGap(row);E.openParams={kind:'window',width:o.width,height:o.height,sill:o.sill,head:o.head,count:row.length,layout:row[0].groupLayout==='even'?'even':'gap',gap:g==null?DEF_PIER:g};E.copyMode=true;E.sel=null;E.tool='window';E.mode='openingPlace';E.ghost=null;updateTools();render();toast(`Укажите стену для копии ряда: ${nWin(row.length)}`);return;}
  E.openParams={kind:o.kind,width:o.width,height:o.height,sill:o.sill,head:o.head,radius:o.radius,hinge:o.hinge,swing:o.swing};E.copyMode=true;E.sel=null;E.tool=o.kind;E.mode='openingPlace';E.ghost=null;updateTools();render();}
let CLIP=null;
function duplicateOpening(o){const i=D.W.get(o.wallId);const off=o.offset+o.width;const fits=off+o.width<=i.len+0.5&&!wallOpenings(o.wallId).some(q=>q.id!==o.id&&off<q.offset+q.width&&q.offset<off+o.width);
  if(fits){const id=uid();const name=newOpeningName(o.kind);const err=apply(Q=>{Q.openings.push(Object.assign({},o,{id,name,offset:off}));Q.seq[o.kind]=(Q.seq[o.kind]||0)+1;});if(err)toast(err,true);else E.sel={type:'opening',id};render();}
  else copyOpening(o);}
async function editDim(item){
  if(item.kind==='fchain'){const f=P.furniture.find(x=>x.id===item.fid);if(!f)return;if(f.locked){toast('Объект зафиксирован. Снимите замок (L)');return;}E.sel={type:'furniture',id:f.id};E.activeDim={type:'furniture',id:f.id};render();const r=await fPositionDialog(f);E.activeDim=null;if(r){const err=fUpdate(f.id,q=>Object.assign(q,r));if(err)toast(err,true);}render();return;}
  if(item.kind==='wall'&&(P.walls.find(x=>x.id===item.wallId)?.locked||P.mode==='furniture')){toast('Стена зафиксирована');return;}
  if(item.kind==='chain'&&(P.openings.find(x=>x.id===item.openingId)?.locked||P.mode==='furniture')){toast('Проём зафиксирован');return;}
  if(item.kind==='wall'){ const i=D.W.get(item.wallId); E.sel={type:'wall',id:item.wallId}; E.activeDim={type:'wall',id:item.wallId}; render();
    const r=await lengthDialog(P.lengthsIncludeThickness?Math.round(i.len+P.wallThickness*kOf(item.wallId)):Math.round(i.len),{title:'Изменить длину стены'}); E.activeDim=null;
    if(r){const err=setWallLength(item.wallId,r.len); if(err)toast(err,true);} render(); return; }
  if(item.kind==='chain'){ const o=P.openings.find(x=>x.id===item.openingId); E.sel={type:'opening',id:o.id}; E.activeDim={type:'opening',id:o.id}; render();
    const r=await positionDialog(o); E.activeDim=null; if(r){const err=apply(Q=>{Q.openings.find(x=>x.id===o.id).offset=r.offset;}); if(err)toast(err,true);} render(); }
}
async function repositionOpening(o){ if(o.locked||P.mode==='furniture'){toast('Объект зафиксирован',true);return;} E.openParams={kind:o.kind,name:o.name,width:o.width,height:o.height,sill:o.sill,head:o.head,radius:o.radius,hinge:o.hinge,swing:o.swing}; apply(Q=>{leaveRow(Q,o.id);Q.openings=Q.openings.filter(x=>x.id!==o.id);},{noHist:true}); E.sel=null; E.tool=o.kind; E.mode='openingPlace'; updateTools(); render(); }

/* ================= Перетаскивание ================= */
function beginDrag(hit,sp){
  if(READONLY)return false;
  const cw=Wd(sp);
  if(P.mode==='furniture'){toast('Стены и проёмы в режиме мебели только для просмотра');return false;}
  if(hit.type==='opening'&&P.openings.find(x=>x.id===hit.id)?.locked){toast('Объект зафиксирован. Снимите замок (L)');return false;}
  if(hit.type==='vertex'&&D.adj.get(hit.id).some(w=>w.locked)){toast('Стена зафиксирована. Снимите замок (L)');return false;}
  if(hit.type==='opening'){const o=P.openings.find(x=>x.id===hit.id); const i=D.W.get(o.wallId); const proj=dot(sub(cw,i.ref),{x:i.rx,y:i.ry}); const row=rowOf(o);
    if(row.length>1){ if(row.some(x=>x.locked)){toast('В ряду есть зафиксированное окно. Снимите замок (L)');return false;} E.drag={type:'opening',id:o.id,row:row.map(x=>({id:x.id,rel:x.offset-row[0].offset,orig:x.offset})),grab:proj-row[0].offset,span:rowSpan(row)}; E.activeDim={type:'opening',id:o.id}; return true; }
    E.drag={type:'opening',id:o.id,grab:proj-o.offset,orig:o.offset}; E.activeDim={type:'opening',id:o.id}; return true;}
  if(hit.type==='vertex'){
    const v=D.V.get(hit.id); const ws=D.adj.get(v.id); let axis=null,wall=null;
    if(ws.length===1){const i=D.W.get(ws[0].id);axis={x:i.ux,y:i.uy};wall=ws[0];}
    else { const i1=D.W.get(ws[0].id),i2=D.W.get(ws[1].id);
      if(i1.ortho&&i2.ortho){ if(Math.abs(i1.ux*i2.ux+i1.uy*i2.uy)>0.99){axis={x:i1.ux,y:i1.uy};wall=ws[0];} else {toast('Обе стены перпендикулярны — измените длину стены');return false;} }
      else if(i1.ortho){axis={x:i1.ux,y:i1.uy};wall=ws[0];} else if(i2.ortho){axis={x:i2.ux,y:i2.uy};wall=ws[1];} else {toast('Обе стены диагональные — измените длины');return false;} }
    E.drag={type:'vertex',id:v.id,axis,wallId:wall.id,orig:{x:v.x,y:v.y},start:{x:v.x,y:v.y}}; E.activeDim={type:'vertex',id:v.id}; return true;
  }
  return false;
}
function updateDrag(sp){
  const cw=Wd(sp); const dr=E.drag;
  if(dr.type==='opening'&&dr.row){const o=P.openings.find(x=>x.id===dr.id);const i=D.W.get(o.wallId);const proj=dot(sub(cw,i.ref),{x:i.rx,y:i.ry});const st=fitOffset(i,dr.span,proj-dr.grab,new Set(dr.row.map(x=>x.id)));if(st!==null)dr.row.forEach(m=>{P.openings.find(x=>x.id===m.id).offset=st+m.rel;});}
  else if(dr.type==='opening'){const o=P.openings.find(x=>x.id===dr.id);const i=D.W.get(o.wallId);const proj=dot(sub(cw,i.ref),{x:i.rx,y:i.ry});const off=fitOffset(i,o.width,proj-dr.grab,o.id);if(off!==null)o.offset=off;}
  else { const v=D.V.get(dr.id); const t=dot(sub(cw,dr.start),dr.axis); v.x=Math.round(dr.start.x+dr.axis.x*t); v.y=Math.round(dr.start.y+dr.axis.y*t); D=derive(P); }
  render();
}
async function endDrag(){
  const dr=E.drag; E.drag=null;
  if(dr.type==='opening'&&dr.row){ const cur=dr.row.map(m=>P.openings.find(x=>x.id===m.id).offset); const curStart=Math.min(...cur);
    dr.row.forEach(m=>{P.openings.find(x=>x.id===m.id).offset=m.orig;});
    const o=P.openings.find(x=>x.id===dr.id); const row=rowOf(o); const gid=o.group;
    const r=await rowPositionDialog(row,curStart); E.activeDim=null;
    if(r){const err=apply(Q=>relayoutRow(Q,gid,r.gap==null?{start:r.start}:{start:r.start,gap:r.gap})); if(err)toast(err,true);} render(); return; }
  if(dr.type==='opening'){ const o=P.openings.find(x=>x.id===dr.id); const cur=o.offset; o.offset=dr.orig; const tmp=Object.assign({},o,{offset:cur});
    const r=await positionDialog(tmp); E.activeDim=null;
    if(r){const err=apply(Q=>{Q.openings.find(x=>x.id===o.id).offset=r.offset;}); if(err)toast(err,true);} render(); return; }
  const v=D.V.get(dr.id); const cur={x:v.x,y:v.y}; v.x=dr.orig.x;v.y=dr.orig.y; D=derive(P);
  const w=P.walls.find(x=>x.id===dr.wallId); const other=D.V.get(w.a===v.id?w.b:w.a); const newLen=Math.round(hyp(sub(cur,other)));
  const r=await lengthDialog(P.lengthsIncludeThickness?newLen+P.wallThickness*kOf(w.id):newLen,{title:'Длина стены после сдвига'}); E.activeDim=null;
  if(r&&r.len>0){ const dir={x:(cur.x-other.x)/(newLen||1),y:(cur.y-other.y)/(newLen||1)}; const err=apply(Q=>{const vv=Q.vertices.find(x=>x.id===v.id); vv.x=Math.round(other.x+dir.x*r.len); vv.y=Math.round(other.y+dir.y*r.len); clampOpenings(Q,derive(Q));}); if(err)toast(err,true); }
  render();
}

/* ================= Ввод ================= */
const cv=$('#c');
function ptOf(e){const r=cv.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
let downInfo=null;
cv.addEventListener('contextmenu',e=>e.preventDefault());
cv.addEventListener('pointerdown',e=>{
  cv.setPointerCapture(e.pointerId); const sp=ptOf(e); E.pointers.set(e.pointerId,sp);
  if(E.pointers.size===2){ const [a,b]=[...E.pointers.values()]; E.gesture={d0:Math.hypot(a.x-b.x,a.y-b.y)||1,c0:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},z0:vp().zoom,v0:{...vp()}}; downInfo=null; E.pan=null; return; }
  if(E.dialogOpen)return;
  if(e.button===1||e.button===2||E.space){E.pan={s:sp,v:{...vp()}};return;}
  downInfo={sp,moved:false,hit:null,touch:e.pointerType==='touch'};
  if(E.mode==='idle'){ downInfo.hit=hitTest(sp); if(!downInfo.hit&&downInfo.touch) E.pan={s:sp,v:{...vp()}}; const hh=downInfo.hit; if(hh&&hh.type!=='dim'&&hh.type!=='viewpoint'){const di=downInfo;di.lp=setTimeout(()=>{if(downInfo===di&&!di.moved){E.sel={type:hh.type,id:hh.id};E.propsOpen=true;di.consumed=true;render();}},450);} }
  if(E.mode==='wallStretch'){E.cursorW=Wd(sp);E.stretch=computeStretch(E.start,E.cursorW);render();}
  if(E.mode==='openingPlace'){E.cursorW=Wd(sp);E.ghost=computeGhost(E.cursorW);render();}
  if(E.mode==='fPlace'){E.cursorW=Wd(sp);E.fGhost=computeFGhost(E.cursorW);render();}
});
cv.addEventListener('pointermove',e=>{
  const sp=ptOf(e); if(E.pointers.has(e.pointerId))E.pointers.set(e.pointerId,sp);
  if(E.gesture&&E.pointers.size===2){ const [a,b]=[...E.pointers.values()]; const d=Math.hypot(a.x-b.x,a.y-b.y)||1, c={x:(a.x+b.x)/2,y:(a.y+b.y)/2}; const g=E.gesture;
    const z=Math.max(zoomMin(),Math.min(ZOOM_MAX,g.z0*d/g.d0)); const w={x:(g.c0.x-g.v0.x)/g.z0,y:(g.c0.y-g.v0.y)/g.z0}; setView(c.x-w.x*z,c.y-w.y*z,z); render(); return; }
  if(E.pan){setView(E.pan.v.x+sp.x-E.pan.s.x,E.pan.v.y+sp.y-E.pan.s.y,E.pan.v.zoom);render();return;}
  if(E.dialogOpen)return;
  E.cursorW=Wd(sp);
  if(downInfo&&!downInfo.moved&&hyp(sub(sp,downInfo.sp))>4){ downInfo.moved=true; clearTimeout(downInfo.lp); if(E.mode==='idle'&&downInfo.hit&&downInfo.hit.type==='furniture'){ if(!beginFDrag(P.furniture.find(x=>x.id===downInfo.hit.id),downInfo.sp)) downInfo=null; } else if(E.mode==='idle'&&downInfo.hit&&(downInfo.hit.type==='opening'||downInfo.hit.type==='vertex')){ if(!beginDrag(downInfo.hit,downInfo.sp)) downInfo=null; } else if(E.mode==='idle'&&!downInfo.hit){E.pan={s:downInfo.sp,v:{...vp()}};} }
  if(E.drag){if(E.drag.type==='furniture')updateFDrag(sp);else updateDrag(sp);return;}
  if(E.mode==='fPlace'){E.fGhost=computeFGhost(E.cursorW);render();return;}
  if(E.mode==='wallStretch'){E.stretch=computeStretch(E.start,E.cursorW);render();return;}
  if(E.mode==='openingPlace'){E.ghost=computeGhost(E.cursorW);render();return;}
  if(E.mode==='wallStart'){render();return;}
  const hv=E.mode==='idle'?hitTest(sp):null; const key=hv?hv.type+(hv.id||''):null;
  cv.style.cursor=E.mode==='idle'?(hv?(hv.type==='dim'?'text':'pointer'):'default'):'crosshair';
  if(key!==E.hover){E.hover=key;render();}
});
function onUp(e){
  const sp=ptOf(e); E.pointers.delete(e.pointerId);
  if(E.gesture){ if(E.pointers.size<2){E.gesture=null; downInfo=null; E.pan=null;} return; }
  if(E.pan){const wasClick=downInfo&&!downInfo.moved; E.pan=null; if(wasClick&&!E.dialogOpen)onClick(sp); downInfo=null; return;}
  if(E.drag){if(E.drag.type==='furniture')endFDrag();else endDrag();downInfo=null;return;}
  if(downInfo){clearTimeout(downInfo.lp);}
  if(downInfo&&!downInfo.moved&&!downInfo.consumed&&!E.dialogOpen){ onClick(sp); }
  downInfo=null;
}
cv.addEventListener('pointerup',onUp); cv.addEventListener('pointercancel',onUp);
cv.addEventListener('wheel',e=>{e.preventDefault(); const sp=ptOf(e); zoomAt(sp.x,sp.y,Math.exp(-e.deltaY*0.0015));},{passive:false});
window.addEventListener('keydown',e=>{
  if(typeof T3!=='undefined'&&T3.active&&handle3DKey(e)){e.preventDefault();return;}
  if(E.dialogOpen)return; const tag=document.activeElement?.tagName; if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA')return;
  const k=e.key.toLowerCase();
  if(e.ctrlKey||e.metaKey){ if(k==='z'&&e.shiftKey){redo();} else if(k==='z'){undo();} else if(k==='y'){redo();} else if(k==='0'){fitRoom();} else if(k==='='||k==='+'){zoomAt(E.W/2,E.H/2,1.25);} else if(k==='-'){zoomAt(E.W/2,E.H/2,0.8);} else if(k==='c'){if(E.sel?.type==='opening'){CLIP=Object.assign({},P.openings.find(o=>o.id===E.sel.id));toast('Скопировано: '+CLIP.name);}else toast('Копируются только проёмы');} else if(k==='v'){if(CLIP)copyOpening(CLIP);else toast('Буфер пуст');} else if(k==='d'){if(E.sel?.type==='opening')duplicateOpening(P.openings.find(o=>o.id===E.sel.id));else toast('Дублируются только проёмы');} else return; e.preventDefault(); return; }
  if(k===' '){E.space=true;e.preventDefault();return;}
  if(e.key==='Alt'){E.alt=true;e.preventDefault();return;}
  if(k==='escape'&&E.mode==='fPlace'){E.mode='idle';E.fPlace=null;E.fGhost=null;E.tool='select';updateTools();render();return;}
  if(k==='r'){ if(E.mode==='fPlace'){E.fRot=(E.fRot+90)%360;if(E.cursorW){E.fGhost=computeFGhost(E.cursorW);}render();} else if(E.sel?.type==='furniture'){const err=fUpdate(E.sel.id,q=>{q.rot=(q.rot+90)%360;});if(err)toast(err,true);} return; }
  if(k==='m'){ if(E.mode==='fPlace'){E.fMirror=!E.fMirror;if(E.cursorW)E.fGhost=computeFGhost(E.cursorW);render();} else if(E.sel?.type==='furniture'){const err=fUpdate(E.sel.id,q=>{q.mirror=!q.mirror;});if(err)toast(err,true);} return; }
  if(k==='l'){toggleLock(E.sel);return;}
  if(k==='escape'){ if(E.mode==='wallStretch'){ if(P.vertices.length===1&&!P.walls.length){apply(Q=>{Q.vertices=[];},{noHist:true});} E.mode='wallStart';E.start=null;E.stretch=null; } else if(E.mode==='openingPlace'){E.tool='select';E.mode='idle';E.ghost=null;E.openParams=null;E.copyMode=false;updateTools();} else if(E.mode==='wallStart'){E.tool='select';E.mode='idle';updateTools();} else if(E.propsOpen){E.propsOpen=false;} else {E.sel=null;} render(); return; }
  if(k==='delete'||k==='backspace'){deleteSelected();e.preventDefault();return;}
  const st=e.shiftKey?200:50; if(k==='arrowleft'){setView(vp().x+st,vp().y,vp().zoom);render();} if(k==='arrowright'){setView(vp().x-st,vp().y,vp().zoom);render();} if(k==='arrowup'){setView(vp().x,vp().y+st,vp().zoom);render();} if(k==='arrowdown'){setView(vp().x,vp().y-st,vp().zoom);render();}
  if(k==='v')setTool('select'); if(k==='w')setTool('wall'); if(k==='o')setTool('door'); if(k==='n')setTool('window'); if(k==='a')setTool('arch');
  if(k==='d')toggleDims(); if(k==='f')fitRoom(); if(k==='p'&&P.closed)togglePoints();
});
window.addEventListener('keyup',e=>{if(e.key===' ')E.space=false;if(e.key==='Alt')E.alt=false;});
function toggleDims(){P.showDims=!P.showDims;save();updateTools();render();}
$('#btnDims').onclick=toggleDims; $('#btnPoints').onclick=()=>{if(P.closed)togglePoints();}; $('#btnFit').onclick=fitRoom; $('#btnUndo').onclick=undo; $('#btnRedo').onclick=redo;
