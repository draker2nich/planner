'use strict';
/* furnitech · редактор · ui/render.js
   Отрисовка плана, размеры, панель свойств выбранного объекта.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ================= Рендер ================= */
function cssv(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim();}
let C={};
function readColors(){C={bg:cssv('--bg'),fg:cssv('--fg'),muted:cssv('--muted-foreground'),accent:cssv('--brand'),danger:cssv('--destructive'),wall:cssv('--wall'),wallFill:cssv('--wall-fill'),grid:cssv('--grid'),gridS:cssv('--grid-strong'),dimA:cssv('--dim-active'),dimI:cssv('--dim-idle'),paper:cssv('--paper')};}
function resize(){const r=cv.parentElement.getBoundingClientRect();E.W=r.width;E.H=r.height;E.dpr=window.devicePixelRatio||1;cv.width=E.W*E.dpr;cv.height=E.H*E.dpr;E.ctx=cv.getContext('2d');readColors();if(P){setView(vp().x,vp().y,vp().zoom);render();}}
window.addEventListener('resize',resize); matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{readColors();render();});

function wallQuad(i){ // внутренняя грань a,b; наружная — со смещением t, миттер с соседями
  const t=P.wallThickness; const n={x:i.nx,y:i.ny}; let oa={x:i.a.x+n.x*t,y:i.a.y+n.y*t}, ob={x:i.b.x+n.x*t,y:i.b.y+n.y*t};
  const miter=(vid,pt,fallback)=>{const ws=D.adj.get(vid).filter(w=>w.id!==i.w.id); if(!ws.length)return fallback; const j=D.W.get(ws[0].id); const q={x:j.a.x+j.nx*t,y:j.a.y+j.ny*t}; const r=lineInter(fallback,{x:i.ux,y:i.uy},q,{x:j.ux,y:j.uy}); if(!r)return fallback; if(hyp(sub(r,pt))>t*4)return fallback; return r;};
  oa=miter(i.w.a,i.a,oa); ob=miter(i.w.b,i.b,ob); return [i.a,i.b,ob,oa];
}
function render(){
  const ctx=E.ctx; if(!ctx)return; ctx.setTransform(E.dpr,0,0,E.dpr,0,0); ctx.clearRect(0,0,E.W,E.H); ctx.fillStyle=C.bg; ctx.fillRect(0,0,E.W,E.H);
  const z=vp().zoom; const tPx=P.wallThickness*z;
  // сетка
  const step=z>=0.05?100:1000; const w0=Wd({x:0,y:0}),w1=Wd({x:E.W,y:E.H});
  ctx.lineWidth=1;
  for(let gx=Math.floor(w0.x/step)*step;gx<=w1.x;gx+=step){const s=S({x:gx,y:0}).x;ctx.strokeStyle=(Math.round(gx)%1000===0)?C.gridS:C.grid;ctx.beginPath();ctx.moveTo(Math.round(s)+.5,0);ctx.lineTo(Math.round(s)+.5,E.H);ctx.stroke();}
  for(let gy=Math.floor(w0.y/step)*step;gy<=w1.y;gy+=step){const s=S({x:0,y:gy}).y;ctx.strokeStyle=(Math.round(gy)%1000===0)?C.gridS:C.grid;ctx.beginPath();ctx.moveTo(0,Math.round(s)+.5);ctx.lineTo(E.W,Math.round(s)+.5);ctx.stroke();}
  drawFloorPlan(ctx);
  // стены
  const quads=new Map();
  for(const w of P.walls){const i=D.W.get(w.id);const q=wallQuad(i).map(S);quads.set(w.id,q);ctx.fillStyle=C.wallFill;ctx.beginPath();q.forEach((p,k)=>k?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();}
  for(const w of P.walls){const q=quads.get(w.id);ctx.strokeStyle=C.wall;ctx.lineWidth=1.2;ctx.beginPath();q.forEach((p,k)=>k?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.stroke();}
  // проёмы
  for(const o of P.openings) drawOpening(o,false);
  drawLocksPlan(ctx);
  drawFurniturePlan(ctx);
  if(E.mode==='openingPlace'&&E.ghost) drawGhost();
  // резиновая линия
  if(E.mode==='wallStretch'&&E.start){ const st=E.stretch; if(st){ const a=S(E.start), b=S(st.end); ctx.setLineDash([6,4]); ctx.strokeStyle=st.blocked?C.danger:C.accent; ctx.lineWidth=2; ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke(); ctx.setLineDash([]);
      if(st.guide){const g=S(st.guide);ctx.setLineDash([3,5]);ctx.strokeStyle=C.muted;ctx.lineWidth=1;ctx.beginPath(); if(st.dirx){ctx.moveTo(g.x,0);ctx.lineTo(g.x,E.H);} else {ctx.moveTo(0,g.y);ctx.lineTo(E.W,g.y);} ctx.stroke();ctx.setLineDash([]);}
      if(st.mode==='diag'||st.closes){const p=S(st.mode==='diag'?st.end:st.closes);ring(p,C.accent);}
      if(st.blocked){ring(S(st.blocked),C.danger);} } }
  // вершины
  const pulse=Date.now()<E.hintUntil;
  for(const v of P.vertices){const p=S(v);const free=D.deg.get(v.id)===1;const isSel=E.sel?.type==='vertex'&&E.sel.id===v.id;const hov=E.hover==='vertex'+v.id;
    ctx.fillStyle=isSel||hov?C.accent:(free?C.accent:C.wall); ctx.beginPath(); const r=free?VERTEX_R+1:VERTEX_R-1; ctx.arc(p.x,p.y,r+(pulse&&free?3*Math.abs(Math.sin(Date.now()/120)):0),0,Math.PI*2); ctx.fill();
    if(free&&E.mode==='wallStart'){ring(p,C.accent);} }
  if(E.mode==='wallStart'&&E.cursorW){const v=vertexNear(S(E.cursorW)); if(v)ring(S(v),D.deg.get(v.id)===1?C.accent:C.danger);}
  drawViewPointsPlan(ctx);
  // подсветка выбранного
  if(E.sel?.type==='wall'||E.hover?.startsWith('wall')){const id=E.sel?.type==='wall'?E.sel.id:E.hover.slice(4);const i=D.W.get(id);if(i){const a=S(i.a),b=S(i.b);ctx.strokeStyle=C.accent;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}}
  // размеры
  drawDims();
  // виджет и статус
  updateWidget(); updateStatus();
  if(typeof T3!=='undefined'&&T3.active)T3.dirty=true; updateLockBtn();
  if(pulse) requestAnimationFrame(render);
}
function drawLocksPlan(ctx){for(const w of P.walls){if(!w.locked)continue;const i=D.W.get(w.id);const m=S({x:(i.a.x+i.b.x)/2+i.nx*P.wallThickness/2,y:(i.a.y+i.b.y)/2+i.ny*P.wallThickness/2});drawLock(ctx,m.x,m.y-8);}for(const o of P.openings){if(!o.locked)continue;const i=D.W.get(o.wallId);const m=S({x:i.ref.x+i.rx*(o.offset+o.width/2)+i.nx*P.wallThickness/2,y:i.ref.y+i.ry*(o.offset+o.width/2)+i.ny*P.wallThickness/2});drawLock(ctx,m.x,m.y-8);}}
function ring(p,color){const ctx=E.ctx;ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,8,0,Math.PI*2);ctx.stroke();}
function openingPts(o,info){const t=P.wallThickness;const p=(along,depth)=>S({x:info.ref.x+info.rx*along+info.nx*depth,y:info.ref.y+info.ry*along+info.ny*depth});return {p00:p(o.offset,0),p10:p(o.offset+o.width,0),p11:p(o.offset+o.width,t),p01:p(o.offset,t),p:p};}
function drawOpening(o,ghost){
  const ctx=E.ctx; const i=D.W.get(o.wallId); if(!i)return; const q=openingPts(o,i); const isSel=E.sel?.type==='opening'&&E.sel.id===o.id; const col=ghost?(ghost==='bad'?C.danger:C.accent):(isSel||E.hover==='opening'+o.id?C.accent:C.wall);
  ctx.fillStyle=C.bg; ctx.beginPath(); [q.p00,q.p10,q.p11,q.p01].forEach((p,k)=>k?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.closePath(); ctx.fill();
  ctx.strokeStyle=col; ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(q.p00.x,q.p00.y);ctx.lineTo(q.p01.x,q.p01.y); ctx.moveTo(q.p10.x,q.p10.y);ctx.lineTo(q.p11.x,q.p11.y); ctx.stroke();
  const t=P.wallThickness;
  if(o.kind==='window'){ ctx.beginPath(); for(const d of [t*0.3,t*0.5,t*0.7]){const a=q.p(o.offset,d),b=q.p(o.offset+o.width,d);ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);} ctx.stroke(); }
  else if(o.kind==='arch'){ ctx.setLineDash([4,3]); ctx.beginPath(); for(const d of [t*0.25,t*0.75]){const a=q.p(o.offset,d),b=q.p(o.offset+o.width,d);ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);} ctx.stroke(); ctx.setLineDash([]); }
  else { // дверь: створка и дуга
    const hingeAlong=o.hinge==='left'?o.offset:o.offset+o.width; const dirAlong=o.hinge==='left'?1:-1; const inward=o.swing==='in'?-1:1; // внутрь = против нормали (нормаль наружу)
    const hp=q.p(hingeAlong,inward>0?t:0); const rPx=o.width*vp().zoom;
    const ax={x:i.rx*dirAlong,y:i.ry*dirAlong}, ay={x:i.nx*inward,y:i.ny*inward};
    const leafEnd={x:hp.x+ay.x*rPx,y:hp.y+ay.y*rPx};
    ctx.beginPath(); ctx.moveTo(hp.x,hp.y); ctx.lineTo(leafEnd.x,leafEnd.y); ctx.stroke();
    const a0=Math.atan2(ax.y,ax.x), a1=Math.atan2(ay.y,ay.x); const df=(((a1-a0)%(Math.PI*2))+Math.PI*2)%(Math.PI*2); const ccw=df>Math.PI; ctx.beginPath(); ctx.arc(hp.x,hp.y,rPx,a0,a1,ccw); ctx.stroke();
  }
  if(isSel&&!ghost){ctx.strokeStyle=C.accent;ctx.lineWidth=2;ctx.beginPath();[q.p00,q.p10,q.p11,q.p01].forEach((p,k)=>k?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.stroke();}
}
function drawGhost(){
  const g=E.ghost,p=E.openParams; if(g.invalid&&g.offs){ g.offs.forEach((o,k)=>drawOpening({id:'ghost'+k,kind:p.kind,wallId:g.info.w.id,offset:o,width:p.width,hinge:'left',swing:'in'},'bad')); const s=S(E.cursorW); label(s.x+12,s.y-12,g.invalid,C.danger); return; }
  if(g.invalid){ const i=g.info; const proj=dot(sub(E.cursorW,i.ref),{x:i.rx,y:i.ry}); const off=Math.max(0,Math.min(i.len-p.width,proj-p.width/2)); drawOpening({id:'ghost',kind:p.kind,wallId:i.w.id,offset:off,width:p.width,hinge:'left',swing:'in'},'bad'); const s=S(E.cursorW); label(s.x+12,s.y-12,g.invalid,C.danger); return; }
  if(g.offs){ g.offs.forEach((o,k)=>drawOpening({id:'ghost'+k,kind:p.kind,wallId:g.info.w.id,offset:o,width:p.width,hinge:'left',swing:'in'},'ok')); const s=S(E.cursorW); label(s.x+12,s.y-12,`${nWin(g.offs.length)} · простенок ${fmtU(g.gap)}`,C.accent); return; }
  drawOpening({id:'ghost',kind:p.kind,wallId:g.info.w.id,offset:g.offset,width:p.width,hinge:'left',swing:'in'},'ok');
}
function label(x,y,text,color){const ctx=E.ctx;ctx.font='12px '+cssv('--font');const w=ctx.measureText(text).width+8;ctx.fillStyle=C.paper;ctx.fillRect(x-4,y-14,w,18);ctx.fillStyle=color;ctx.fillText(text,x,y);}

/* ---- размеры ---- */
function isActiveWall(id){const a=E.activeDim; if(!a)return false; if(a.type==='wall'&&a.id===id)return true; if(a.type==='vertex'){const w=P.walls.find(x=>x.id===id);return w.a===a.id||w.b===a.id;} return false;}
function collectDims(){
  const items=[]; const showAll=P.showDims; const sel=E.sel;
  const walls=new Set(), ops=new Set();
  if(showAll){P.walls.forEach(w=>walls.add(w.id));P.openings.forEach(o=>ops.add(o.id));}
  else { if(!P.closed)P.walls.forEach(w=>walls.add(w.id));
    if(sel?.type==='wall')walls.add(sel.id); if(sel?.type==='vertex')D.adj.get(sel.id)?.forEach(w=>walls.add(w.id)); if(sel?.type==='opening')ops.add(sel.id); }
  if(E.drag?.type==='vertex')D.adj.get(E.drag.id).forEach(w=>walls.add(w.id));
  if(E.activeDim?.type==='wall')walls.add(E.activeDim.id);
  for(const id of walls){const i=D.W.get(id); if(!i)continue; items.push({kind:'wall',wallId:id,p1:i.a,p2:i.b,n:{x:i.nx,y:i.ny},text:fmt(i.len),active:isActiveWall(id),level:1,len:i.len});}
  for(const id of ops){const o=P.openings.find(x=>x.id===id); if(!o)continue; const i=D.W.get(o.wallId); if(!i)continue; const act=E.activeDim?.type==='opening'&&E.activeDim.id===id||E.drag?.type==='opening'&&E.drag.id===id;
    const pt=(a)=>({x:i.ref.x+i.rx*a,y:i.ref.y+i.ry*a}); const n={x:i.nx,y:i.ny}; const rem=i.len-o.offset-o.width;
    if(o.offset>0.5)items.push({kind:'chain',part:'off',openingId:id,wallId:o.wallId,p1:pt(0),p2:pt(o.offset),n,text:fmt(o.offset),active:act,level:1,len:o.offset});
    items.push({kind:'chain',part:'w',openingId:id,wallId:o.wallId,p1:pt(o.offset),p2:pt(o.offset+o.width),n,text:fmt(o.width),active:act,level:1,len:o.width});
    if(rem>0.5)items.push({kind:'chain',part:'rem',openingId:id,wallId:o.wallId,p1:pt(o.offset+o.width),p2:pt(i.len),n,text:fmt(rem),active:act,level:1,len:rem});
    if(showAll){ let t=`h ${fmt(o.height)}`; if(o.kind==='window')t+=`, пол ${fmt(o.sill)}, потолок ${fmt(o.head)}`; if(o.kind==='arch')t+=`, r ${fmt(o.radius)}`; items.push({kind:'plaque',openingId:id,wallId:o.wallId,name:o.name,anchor:pt(o.offset+o.width/2),n,text:t}); }
  }
  collectFurnitureDims(items);
  if(E.mode==='wallStretch'&&E.start&&E.stretch&&E.stretch.len>0){const st=E.stretch;const d=sub(st.end,E.start);const L=hyp(d)||1;items.push({kind:'temp',p1:{...E.start},p2:st.end,n:{x:-d.y/L,y:d.x/L},text:fmt(Math.round(st.len)),active:true,level:1,len:st.len});}
  return items;
}
function dimGeom(it){
  const ctx=E.ctx; const z=vp().zoom; const tPx=P.wallThickness*z; const off=(it.kind==='temp'||it.kind==='fchain'?8:tPx)+DIM_OFF*it.level;
  const p1=S(it.p1),p2=S(it.p2); const n=it.n; const q1={x:p1.x+n.x*off,y:p1.y+n.y*off},q2={x:p2.x+n.x*off,y:p2.y+n.y*off};
  const e1={x:p1.x+n.x*(off+4),y:p1.y+n.y*(off+4)},e2={x:p2.x+n.x*(off+4),y:p2.y+n.y*(off+4)};
  ctx.font='12px '+cssv('--font'); const tw=ctx.measureText(it.text).width; const segPx=hyp(sub(q2,q1));
  let ang=Math.atan2(q2.y-q1.y,q2.x-q1.x); if(ang>Math.PI/2||ang<=-Math.PI/2)ang+=Math.PI;
  const dir={x:(q2.x-q1.x)/(segPx||1),y:(q2.y-q1.y)/(segPx||1)};
  let tc={x:(q1.x+q2.x)/2,y:(q1.y+q2.y)/2}; let leader=false;
  if(tw+8>segPx-4){leader=true;tc={x:q2.x+dir.x*(tw/2+12),y:q2.y+dir.y*(tw/2+12)};}
  else if(segPx>0){ // не ближе 16px к вершине
    const half=tw/2+4; if(segPx/2-half<16&&segPx>2*half){/* центр остаётся */} }
  const bw=tw+8,bh=18; const cs=Math.abs(Math.cos(ang)),sn=Math.abs(Math.sin(ang)); const rw=bw*cs+bh*sn,rh=bw*sn+bh*cs;
  return {p1,p2,q1,q2,e1,e2,tc,ang,tw,bw,bh,leader,segPx,rect:{x:tc.x-rw/2,y:tc.y-rh/2,w:rw,h:rh}};
}
function drawDims(){
  const ctx=E.ctx; E.dimHits=[]; E.markers=[]; const items=collectDims(); if(!items.length){$('#dimlist').hidden=true;return;}
  const z=vp().zoom; const showAll=P.showDims;
  if(showAll&&P.walls.length){const avg=P.walls.reduce((s,w)=>s+D.W.get(w.id).len,0)/P.walls.length*z; if(avg<40){ if(!E.zoomHintShown){toast('Приблизьте, чтобы увидеть размеры');E.zoomHintShown=true;} $('#dimlist').hidden=true; return;} }
  // уровни
  const byWall=new Map(); items.forEach(it=>{if(it.wallId){if(!byWall.has(it.wallId))byWall.set(it.wallId,[]);byWall.get(it.wallId).push(it);}});
  ctx.font='12px '+cssv('--font');
  for(const [wid,list] of byWall){ const chain=list.filter(i=>i.kind==='chain'), wall=list.find(i=>i.kind==='wall'); if(!chain.length){if(wall)wall.level=1;continue;}
    const wpx=D.W.get(wid).len*z; const total=chain.reduce((s,c)=>s+ctx.measureText(c.text).width+8,0)+8*(chain.length-1);
    if(total>wpx){chain.forEach((c,k)=>c.level=1+(k%2)); if(wall)wall.level=3;} else {chain.forEach(c=>c.level=1); if(wall)wall.level=2;} }
  const placed=[]; const order=items.filter(i=>i.kind!=='plaque').sort((a,b)=>(a.kind==='chain'?0:1)-(b.kind==='chain'?0:1)||b.len-a.len);
  for(const it of order){ let g=dimGeom(it); let tries=0; while(placed.some(r=>rectsOverlap(r,g.rect,2))&&tries<5){it.level++;g=dimGeom(it);tries++;} it.g=g; placed.push(g.rect); }
  // отрисовка
  for(const it of order){ const g=it.g; const col=it.active?C.dimA:C.dimI; ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(g.p1.x,g.p1.y);ctx.lineTo(g.e1.x,g.e1.y); ctx.moveTo(g.p2.x,g.p2.y);ctx.lineTo(g.e2.x,g.e2.y); ctx.moveTo(g.q1.x,g.q1.y);ctx.lineTo(g.q2.x,g.q2.y); ctx.stroke();
    arrow(g.q1,g.q2,g.segPx<24); arrow(g.q2,g.q1,g.segPx<24);
    if(g.leader){ctx.beginPath();ctx.moveTo(g.q2.x,g.q2.y);ctx.lineTo(g.tc.x,g.tc.y);ctx.stroke();}
    ctx.save(); ctx.translate(g.tc.x,g.tc.y); ctx.rotate(g.ang); ctx.fillStyle=C.paper; ctx.fillRect(-g.bw/2,-g.bh/2,g.bw,g.bh); ctx.fillStyle=it.active?C.dimA:C.muted; ctx.textAlign='center';ctx.textBaseline='middle'; ctx.fillText(it.text,0,0); ctx.restore();
    if(it.kind!=='temp')E.dimHits.push({rect:g.rect,item:it});
  }
  // плашки
  const plaques=items.filter(i=>i.kind==='plaque'); const list=[]; let num=0;
  const wallSegs=P.walls.map(w=>{const i=D.W.get(w.id);return [S(i.a),S(i.b)];}); const tPx=P.wallThickness*z;
  for(const pl of plaques){ const tw=ctx.measureText(pl.text).width+12, th=20; const a=S(pl.anchor); const n=pl.n; const maxL=Math.max(1,...items.filter(i=>i.wallId===pl.wallId&&i.g).map(i=>i.level));
    const cands=[]; const out=tPx+DIM_OFF*(maxL+1); cands.push({x:a.x+n.x*out-tw/2,y:a.y+n.y*out-th/2,w:tw,h:th}); const inn=20+th/2; cands.push({x:a.x-n.x*inn-tw/2,y:a.y-n.y*inn-th/2,w:tw,h:th});
    const i=D.W.get(pl.wallId); const along={x:i.rx*z,y:i.ry*z}; const al=hyp(along)||1; const ux=along.x/al,uy=along.y/al;
    cands.push({x:a.x+n.x*out+ux*tw-tw/2,y:a.y+n.y*out+uy*tw-th/2,w:tw,h:th},{x:a.x+n.x*out-ux*tw-tw/2,y:a.y+n.y*out-uy*tw-th/2,w:tw,h:th});
    let ok=null; for(const c of cands){ const bad=placed.some(r=>rectsOverlap(r,c,4))||wallSegs.some(([p,q])=>rectSegInter({x:c.x-tPx,y:c.y-tPx,w:c.w+2*tPx,h:c.h+2*tPx},p,q))||c.x<0||c.y<0||c.x+c.w>E.W||c.y+c.h>E.H; if(!bad){ok=c;break;} }
    if(ok){ placed.push(ok); ctx.fillStyle=C.paper;ctx.strokeStyle=C.dimI;ctx.lineWidth=1; rr(ok.x,ok.y,ok.w,ok.h,4); ctx.fill();ctx.stroke(); ctx.fillStyle=C.muted;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(pl.text,ok.x+ok.w/2,ok.y+ok.h/2); }
    else { num++; const m={x:a.x+n.x*(tPx+10),y:a.y+n.y*(tPx+10)}; ctx.fillStyle=C.accent;ctx.beginPath();ctx.arc(m.x,m.y,9,0,Math.PI*2);ctx.fill(); ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(num),m.x,m.y); list.push({n:num,name:pl.name,text:pl.text}); }
  }
  const dl=$('#dimlist'); if(list.length){dl.hidden=false;dl.innerHTML='';dl.append(h('h4',{},'Размеры'));list.forEach(l=>dl.append(h('div',{},h('b',{},String(l.n)),h('span',{},`${l.name}: ${l.text}`))));} else dl.hidden=true;
  ctx.textAlign='start';ctx.textBaseline='alphabetic';
}
function arrow(from,to,outside){const ctx=E.ctx;const d=sub(to,from);const L=hyp(d)||1;const ux=d.x/L,uy=d.y/L;const s=outside?-1:1;const tip=from;const b={x:tip.x+ux*8*s,y:tip.y+uy*8*s};ctx.beginPath();ctx.moveTo(tip.x,tip.y);ctx.lineTo(b.x-uy*3,b.y+ux*3);ctx.lineTo(b.x+uy*3,b.y-ux*3);ctx.closePath();ctx.fill();}
function rr(x,y,w,h,r){const ctx=E.ctx;ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}

/* ================= Виджет выбора ================= */
function updateStatus(){const s=$('#status');const m={idle:E.tool==='select'?(IS_TOUCH?'Нажмите на стену, точку или проём. Один палец по пустому месту — сдвиг, два — масштаб. Долгое нажатие — свойства':'Выбор: клик по стене, точке или проёму. Правая кнопка / два пальца — панорама, колесо — масштаб'):'',wallStart:P.vertices.length?'Кликните по свободной точке контура':'Кликните, чтобы поставить первую точку',wallStretch:'Ведите линию и кликните для ввода длины. Esc — отмена',openingPlace:(E.copyMode?'Копия: ':'')+'Ведите по стене и кликните для размещения. Esc — отмена',fPlace:'Размещение: клик — поставить, R — поворот, M — зеркало, Alt — без привязки, Esc — отмена'}[E.mode]||'';const txt=m+(P.closed?'  •  Контур замкнут':'');if(!txt){s.textContent='';return;}if(!s.firstElementChild)s.append(h('span',{}));s.firstElementChild.textContent=txt;}
function buildFullWidget(wg){
  const sel=E.sel; if(!sel||E.drag||E.mode!=='idle')return null;
  wg.hidden=false; wg.innerHTML=''; let anchor=null, n=null;
  const row=(lbl,val,onSet,ro)=>{const inp=h('input',{type:'text',value:val==null?'':fmt(val)});if(ro||!onSet)inp.readOnly=true;else{inp.onchange=()=>{const v=parseLen(inp.value);if(isNaN(v)){toast('Введите число',true);inp.value=fmt(val);return;}const err=onSet(v);if(err){toast(err,true);inp.value=fmt(val);}};}return h('div',{class:'row'},h('span',{},lbl),inp);};
  const roSel=isLocked(sel)||(P.mode==='furniture'&&sel.type!=='furniture'&&sel.type!=='floor');
  if(sel.type==='furniture'){ const f=(P.furniture||[]).find(x=>x.id===sel.id); if(!f||P.mode!=='furniture')return null; const pts=fWorldOf(f,P,D); const a=aabbOf(pts); anchor={x:a.cx,y:a.y1}; n={x:0,y:1}; furnitureWidget(wg,f); }
  else if(sel.type==='floor'){ const poly=innerPoly(); if(!poly)return null; const c=polyCentroid(poly); anchor=c; n={x:0,y:-1}; const per=P.walls.reduce((s,w)=>s+D.W.get(w.id).len,0);
    wg.append(h('h4',{},'Пол'),h('div',{class:'row'},h('span',{},'Площадь'),h('span',{},m2(Math.abs(D.area)))),h('div',{class:'row'},h('span',{},'Периметр'),h('span',{},fmtU(Math.round(per)))),h('div',{class:'row'},h('span',{},'Материал'),h('span',{},matName(P.floor?.material))),
      h('div',{class:'acts'},h('button',{onclick:()=>enter3D(nearestPointTo(c),{material:{type:'floor'}})},'Изменить в 3D'))); }
  if(sel.type==='wall'){ const i=D.W.get(sel.id); if(!i)return null; const k=kOf(sel.id); anchor={x:(i.a.x+i.b.x)/2,y:(i.a.y+i.b.y)/2}; n={x:i.nx,y:i.ny};
    wg.append(h('h4',{},'Стена',h('button',{type:'button',class:'lk','aria-label':'Зафиксировать',title:'Зафиксировать (L)',onclick:()=>toggleLock(sel)},lockIcon(isLocked(sel)))),row('Длина внутр.',Math.round(i.len),(v)=>setWallLength(sel.id,v)),row('Длина наруж.',Math.round(i.len+P.wallThickness*k),null,true),row('Высота',P.wallHeight,null,true),row('Толщина',P.wallThickness,null,true),
      h('div',{class:'row'},h('span',{},'Проёмов'),h('span',{},String(wallOpenings(sel.id).length))),h('div',{class:'row'},h('span',{},'Материал'),h('span',{},matName(P.walls.find(w=>w.id===sel.id)?.material))),
      h('div',{class:'acts'},P.closed?h('button',{onclick:()=>{const mid={x:(i.a.x+i.b.x)/2,y:(i.a.y+i.b.y)/2};enter3D(nearestPointTo(mid),{lookAt:mid,material:{type:'wall',id:sel.id}});}},'Изменить в 3D'):null,h('button',{class:'del',onclick:()=>deleteWall(sel.id)},'Удалить'))); }
  else if(sel.type==='vertex'){ const v=D.V.get(sel.id); if(!v)return null; anchor=v; const ws=D.adj.get(v.id); n={x:0,y:-1}; wg.append(h('h4',{},'Точка'));
    ws.forEach((w,k)=>{const i=D.W.get(w.id);wg.append(row(`Стена ${k+1}`,Math.round(i.len),(val)=>setWallLength(w.id,val)));}); }
  else if(sel.type==='opening'){ const o=P.openings.find(x=>x.id===sel.id); if(!o)return null; const i=D.W.get(o.wallId); anchor={x:i.ref.x+i.rx*(o.offset+o.width/2),y:i.ref.y+i.ry*(o.offset+o.width/2)}; n={x:i.nx,y:i.ny};
    const rw=rowOf(o), inRow=o.kind==='window'&&rw.length>1, gid=o.group;
    const upd=(fn)=>{return apply(Q=>{const ts=inRow?Q.openings.filter(x=>x.group===gid):[Q.openings.find(x=>x.id===o.id)];ts.forEach(q=>{fn(q);if(q.kind==='window')q.head=Q.wallHeight-q.sill-q.height;});});};
    wg.append(h('h4',{},o.name,h('button',{type:'button',class:'lk','aria-label':'Зафиксировать',title:'Зафиксировать (L)',onclick:()=>toggleLock(sel)},lockIcon(o.locked))));
    if(inRow){const ug=rowUniformGap(rw);wg.append(h('div',{class:'rowinfo'},ic('window'),h('span',{},`Ряд: ${nWin(rw.length)} · ${rw[0].groupLayout==='even'?'равномерно по стене':'с простенком'}`)),h('div',{class:'hint rowhint'},'Размеры и высота меняются у всех окон ряда сразу.'));}
    wg.append(row('Ширина',o.width,(v)=>inRow?apply(Q=>relayoutRow(Q,gid,{width:v})):upd(q=>{q.width=v;})),row('Высота',o.height,(v)=>upd(q=>{q.height=v;})));
    if(o.kind==='window'){wg.append(row('От пола',o.sill,(v)=>upd(q=>{q.sill=v;})),row('До потолка',o.head,(v)=>upd(q=>{q.sill=Q_head(q,v);})));}
    if(o.kind==='arch')wg.append(row('Радиус',o.radius,(v)=>upd(q=>{q.radius=v;})));
    if(o.kind==='door'){const sh=h('select',{},h('option',{value:'left'},'Петли слева'),h('option',{value:'right'},'Петли справа'));sh.value=o.hinge;sh.onchange=()=>upd(q=>{q.hinge=sh.value;});const ss=h('select',{},h('option',{value:'in'},'Внутрь'),h('option',{value:'out'},'Наружу'));ss.value=o.swing;ss.onchange=()=>upd(q=>{q.swing=ss.value;});wg.append(h('div',{class:'row'},h('span',{},'Петли'),sh),h('div',{class:'row'},h('span',{},'Открывание'),ss));}
    if(inRow){ const sp=rowSpan(rw), ug=rowUniformGap(rw);
      wg.append(row('Ряд от стены',rw[0].offset,(v)=>apply(Q=>relayoutRow(Q,gid,{start:v}))),row('Ряд до другой',Math.round(i.len-rw[0].offset-sp),(v)=>apply(Q=>relayoutRow(Q,gid,{start:Math.round(i.len-v-sp)}))),
        ...(ug!=null?[row('Простенок',ug,(v)=>{if(v<0)return 'Простенок не может быть меньше 0';return apply(Q=>relayoutRow(Q,gid,{gap:v}));})]:[]),
        h('div',{class:'acts'},rw[0].groupLayout!=='even'?h('button',{onclick:()=>{const e=apply(Q=>relayoutRow(Q,gid,{layout:'even'}));if(e)toast(e,true);else render();}},'Равномерно'):null,
          h('button',{onclick:()=>copyOpening(o)},'Копировать ряд'),h('button',{title:'Окно станет самостоятельным, остальные останутся на месте',onclick:()=>{if(o.locked){toast('Объект зафиксирован',true);return;}const e=apply(Q=>leaveRow(Q,o.id));if(e)toast(e,true);else{toast(`${o.name} больше не в ряду`);render();}}},'Отделить'),
          h('button',{class:'del',onclick:()=>deleteOpening(o.id)},'Удалить окно'),h('button',{class:'del',onclick:()=>deleteRow(o)},'Удалить ряд'))); }
    else wg.append(row('От стены',o.offset,(v)=>upd(q=>{q.offset=v;})),row('До другой',Math.round(i.len-o.offset-o.width),(v)=>upd(q=>{q.offset=Math.round(i.len-v-q.width);})),
      h('div',{class:'acts'},h('button',{onclick:()=>repositionOpening(o)},'Переставить'),h('button',{onclick:()=>copyOpening(o)},'Копировать'),h('button',{class:'del',onclick:()=>deleteOpening(o.id)},'Удалить'))); }
  if(roSel){wg.querySelectorAll('input').forEach(i=>{i.readOnly=true;});wg.querySelectorAll('select').forEach(i=>{i.disabled=true;});wg.querySelectorAll('.acts button').forEach(b=>{if(!/Копировать|Изменить в 3D/.test(b.textContent))b.disabled=true;});}
  return {anchor,n};
}
function Q_head(q,head){return P.wallHeight-head-q.height;}
