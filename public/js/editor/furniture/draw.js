'use strict';
/* furnitech · редактор · furniture/draw.js
   Условные символы и отрисовка мебели на плане.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ---------- Символы ---------- */
const SYM={};
function symLine(ctx,pts,close){ctx.beginPath();pts.forEach((p,k)=>k?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));if(close)ctx.closePath();ctx.stroke();}
SYM.generic=(c,l,d,f)=>{};
SYM.sofa=(c,l,d,f)=>{const x0=-l.w/2,y0=-l.h/2;const dd=d.D||900;const back=Math.min(180,dd*0.25);const arm=Math.min(150,dd*0.2);
  if(f.fp==='rect'){c.strokeRect(x0,y0,l.w,back);c.strokeRect(x0,y0,arm,l.h);c.strokeRect(x0+l.w-arm,y0,arm,l.h);const n=Math.max(1,Math.round((l.w-2*arm)/650));const sw=(l.w-2*arm)/n;for(let i=0;i<n;i++)c.strokeRect(x0+arm+i*sw,y0+back,sw,l.h-back);}
  else{const A=d.A,B=d.B,D2=Math.min(d.D,A,B);c.strokeRect(x0,y0,A,back);c.strokeRect(x0+A-back,y0,back,B);c.strokeRect(x0,y0,arm,D2);const n=Math.max(1,Math.round((A-D2)/650));const sw=(A-D2-arm)/n;for(let i=0;i<n;i++)c.strokeRect(x0+arm+i*sw,y0+back,sw,D2-back);c.strokeRect(x0+A-D2,y0+D2,D2-back,B-D2);if(f.fp==='U'){c.strokeRect(x0,y0,back,B);c.strokeRect(x0+back,y0+D2,D2-back,B-D2);}}};
SYM.armchair=(c,l,d)=>{const x0=-l.w/2,y0=-l.h/2;const b=Math.min(160,l.h*0.25);c.strokeRect(x0,y0,l.w,b);c.strokeRect(x0,y0,b,l.h);c.strokeRect(x0+l.w-b,y0,b,l.h);c.strokeRect(x0+b,y0+b,l.w-2*b,l.h-b);};
SYM.pouf=(c,l,d,f)=>{c.beginPath();c.moveTo(-l.w*0.3,0);c.lineTo(l.w*0.3,0);c.moveTo(0,-l.h*0.3);c.lineTo(0,l.h*0.3);c.stroke();};
SYM.table=(c,l,d,f)=>{const k=0.9;if(f.fp==='circle'||f.fp==='ellipse'){c.beginPath();c.ellipse(0,0,l.w/2*k,l.h/2*k,0,0,7);c.stroke();}else if(f.fp==='L'){}else{c.strokeRect(-l.w/2*k,-l.h/2*k,l.w*k,l.h*k);}};
SYM.chair=(c,l,d,f)=>{const x0=-l.w/2,y0=-l.h/2;if(f.fp==='circle'){c.beginPath();c.arc(0,0,l.w*0.25,0,7);c.stroke();for(let i=0;i<5;i++){const a=i/5*Math.PI*2;c.beginPath();c.moveTo(0,0);c.lineTo(Math.cos(a)*l.w/2,Math.sin(a)*l.w/2);c.stroke();}}else{c.strokeRect(x0,y0,l.w,l.h*0.18);c.strokeRect(x0+l.w*0.08,y0+l.h*0.18,l.w*0.84,l.h*0.82);}};
SYM.bench=(c,l)=>{c.strokeRect(-l.w/2,-l.h/2,l.w,l.h*0.25);};
SYM.bed=(c,l,d)=>{const x0=-l.w/2,y0=-l.h/2;const hb=Math.min(120,l.h*0.08);c.strokeRect(x0,y0,l.w,hb);const n=l.w>1300?2:1;const pw=(l.w-(n+1)*60)/n;for(let i=0;i<n;i++){c.strokeRect(x0+60+i*(pw+60),y0+hb+60,pw,Math.min(420,l.h*0.22));}c.beginPath();c.moveTo(x0,y0+l.h*0.38);c.lineTo(x0+l.w,y0+l.h*0.38);c.stroke();};
SYM.cabinet=(c,l,d)=>{const x0=-l.w/2,y0=-l.h/2;const n=Math.max(1,Math.round(l.w/500));const sw=l.w/n;for(let i=0;i<n;i++){c.beginPath();c.moveTo(x0+i*sw+sw*0.35,y0+l.h*0.85);c.lineTo(x0+i*sw+sw*0.65,y0+l.h*0.85);c.stroke();if(i)symLine(c,[{x:x0+i*sw,y:y0},{x:x0+i*sw,y:y0+l.h}]);}};
SYM.wardrobe=(c,l,d,f)=>{const x0=-l.w/2,y0=-l.h/2;if(f.fp==='L'){c.beginPath();c.moveTo(x0,y0);c.lineTo(x0+l.w,y0+d.D);c.moveTo(x0+l.w,y0);c.lineTo(x0,y0+d.D);c.stroke();}else{c.beginPath();c.moveTo(x0,y0);c.lineTo(x0+l.w,y0+l.h);c.moveTo(x0+l.w,y0);c.lineTo(x0,y0+l.h);c.stroke();}};
SYM.shelf=(c,l)=>{const x0=-l.w/2,y0=-l.h/2;const n=Math.max(1,Math.round(l.w/400));for(let i=1;i<n;i++)symLine(c,[{x:x0+i*l.w/n,y:y0},{x:x0+i*l.w/n,y:y0+l.h}]);symLine(c,[{x:x0,y:0},{x:x0+l.w,y:0}]);};
SYM.tv=(c,l)=>{c.strokeRect(-l.w/2,-l.h/2,l.w,l.h*0.5);c.beginPath();c.moveTo(-l.w*0.1,l.h/2);c.lineTo(l.w*0.1,l.h/2);c.moveTo(0,-l.h/2+l.h*0.5);c.lineTo(0,l.h/2);c.stroke();};
SYM.kitchen=(c,l,d,f)=>{if(f.fp==='L'){const A=d.A,B=d.B,D2=d.D;const x0=-l.w/2,y0=-l.h/2;symLine(c,[{x:x0+60,y:y0+60},{x:x0+A-60,y:y0+60},{x:x0+A-60,y:y0+B-60},{x:x0+A-D2+60,y:y0+B-60},{x:x0+A-D2+60,y:y0+D2-60},{x:x0+60,y:y0+D2-60}],true);}else{c.strokeRect(-l.w/2+60,-l.h/2+60,l.w-120,l.h-120);const n=Math.max(1,Math.round(l.w/600));for(let i=1;i<n;i++)symLine(c,[{x:-l.w/2+i*l.w/n,y:-l.h/2},{x:-l.w/2+i*l.w/n,y:l.h/2}]);}};
SYM.sink=(c,l,d,f)=>{if(f.fp==='circle'){c.beginPath();c.arc(0,0,l.w*0.35,0,7);c.stroke();}else{c.strokeRect(-l.w*0.4,-l.h*0.35,l.w*0.8,l.h*0.7);}c.beginPath();c.arc(0,-l.h*0.42,25,0,7);c.stroke();};
SYM.stove=(c,l)=>{const r=Math.min(l.w,l.h)*0.16;[[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([a,b])=>{c.beginPath();c.arc(a*l.w*0.25,b*l.h*0.25,r,0,7);c.stroke();});};
SYM.fridge=(c,l)=>{c.beginPath();c.moveTo(-l.w/2,-l.h/2);c.lineTo(l.w/2,l.h/2);c.stroke();c.strokeRect(-l.w/2+30,-l.h/2+30,l.w-60,l.h-60);};
SYM.appliance=(c,l)=>{c.beginPath();c.moveTo(-l.w/2,-l.h/2);c.lineTo(l.w/2,l.h/2);c.moveTo(l.w/2,-l.h/2);c.lineTo(-l.w/2,l.h/2);c.stroke();};
SYM.bath=(c,l,d,f)=>{if(f.fp==='quarter'){const r=d.R;c.beginPath();c.arc(-l.w/2,-l.h/2,r*0.7,0.15,Math.PI/2-0.15);c.stroke();c.beginPath();c.arc(-l.w/2+r*0.3,-l.h/2+r*0.3,30,0,7);c.stroke();}else{c.beginPath();c.ellipse(0,0,l.w*0.42,l.h*0.36,0,0,7);c.stroke();c.beginPath();c.arc(-l.w*0.35,0,30,0,7);c.stroke();}};
SYM.shower=(c,l,d,f)=>{if(f.fp==='quarter'){const r=d.R;c.beginPath();c.moveTo(-l.w/2,-l.h/2);c.lineTo(-l.w/2+r*0.9,-l.h/2+r*0.9);c.stroke();}else{c.beginPath();c.moveTo(-l.w/2,-l.h/2);c.lineTo(l.w/2,l.h/2);c.moveTo(l.w/2,-l.h/2);c.lineTo(-l.w/2,l.h/2);c.stroke();}c.beginPath();c.arc(0,0,40,0,7);c.stroke();};
SYM.basin=(c,l,d,f)=>{if(f.fp==='circle'){c.beginPath();c.arc(0,0,l.w*0.38,0,7);c.stroke();}else{c.beginPath();c.ellipse(0,l.h*0.05,l.w*0.36,l.h*0.32,0,0,7);c.stroke();}c.beginPath();c.arc(0,-l.h*0.4,20,0,7);c.stroke();};
SYM.toilet=(c,l)=>{c.strokeRect(-l.w/2,-l.h/2,l.w,l.h*0.3);c.beginPath();c.ellipse(0,l.h*0.18,l.w*0.4,l.h*0.3,0,0,7);c.stroke();};
SYM.rug=(c,l)=>{};
SYM.plant=(c,l)=>{for(let i=0;i<6;i++){const a=i/6*Math.PI*2;c.beginPath();c.ellipse(Math.cos(a)*l.w*0.22,Math.sin(a)*l.w*0.22,l.w*0.22,l.w*0.1,a,0,7);c.stroke();}};
SYM.lamp=(c,l)=>{c.beginPath();c.moveTo(-l.w/2,0);c.lineTo(l.w/2,0);c.moveTo(0,-l.h/2);c.lineTo(0,l.h/2);c.stroke();};
SYM.chandelier=(c,l)=>{for(let i=0;i<8;i++){const a=i/8*Math.PI*2;c.beginPath();c.moveTo(0,0);c.lineTo(Math.cos(a)*l.w/2,Math.sin(a)*l.w/2);c.stroke();}c.beginPath();c.arc(0,0,l.w*0.2,0,7);c.stroke();};
SYM.ac=(c,l)=>{c.beginPath();for(let i=1;i<4;i++){c.moveTo(-l.w/2+40,-l.h/2+i*l.h/4);c.lineTo(l.w/2-40,-l.h/2+i*l.h/4);}c.stroke();};
SYM.radiator=(c,l)=>{const n=Math.max(2,Math.round(l.w/80));for(let i=1;i<n;i++)symLine(c,[{x:-l.w/2+i*l.w/n,y:-l.h/2},{x:-l.w/2+i*l.w/n,y:l.h/2}]);};
SYM.picture=(c,l)=>{c.strokeRect(-l.w/2+20,-l.h/2+10,l.w-40,l.h-20);};
SYM.curtain=(c,l)=>{c.beginPath();const n=Math.max(4,Math.round(l.w/150));for(let i=0;i<=n;i++){const x=-l.w/2+i*l.w/n;c.lineTo(x,(i%2?1:-1)*l.h*0.35);}c.stroke();};
SYM.fireplace=(c,l,d,f)=>{if(f.fp==='quarter'){c.beginPath();c.arc(-l.w/2,-l.h/2,d.R*0.6,0.2,Math.PI/2-0.2);c.stroke();}else{c.strokeRect(-l.w*0.3,-l.h/2,l.w*0.6,l.h*0.7);}};

/* ---------- Отрисовка мебели в плане ---------- */
function drawFurniturePlan(ctx){
  const items=P.furniture||[]; if(!items.length)return; const faded=P.mode!=='furniture';
  const layers={under:0,floor:1,ontop:2}; const sorted=[...items].sort((a,b)=>layers[TYPE.get(a.typeId).layer]-layers[TYPE.get(b.typeId).layer]);
  for(const f of sorted)drawFurnitureItem(ctx,f,{faded,sel:E.sel?.type==='furniture'&&E.sel.id===f.id,hover:E.hover==='furniture'+f.id});
  if(E.mode==='fPlace'&&E.fGhost)drawFurnitureItem(ctx,E.fGhost.item,{ghost:E.fGhost.invalid?'bad':'ok'});
}
function furniturePlacementFrame(f){ // {x,y,rot} в мировых координатах, учитывая wall‑mount
  const t=TYPE.get(f.typeId),fo=formOf(t,f.formId),mt=mountOf(t,fo);
  if(mt==='wall'){const i=D.W.get(f.wallId);if(!i)return null;const c={x:i.ref.x+i.rx*(f.offset+f.dims.W/2),y:i.ref.y+i.ry*(f.offset+f.dims.W/2)};return {x:c.x-i.nx*f.dims.D/2,y:c.y-i.ny*f.dims.D/2,rot:Math.atan2(i.nx,-i.ny)*180/Math.PI,mirror:false};}
  return {x:f.x,y:f.y,rot:f.rot,mirror:f.mirror};
}
function drawFurnitureItem(ctx,f,o={}){
  const t=TYPE.get(f.typeId);if(!t)return;const fo=formOf(t,f.formId);const l=fpPoly(fo.fp,f.dims);const fr=furniturePlacementFrame(f);if(!fr)return;
  const z=vp().zoom;const s=S(fr);const col=o.ghost?(o.ghost==='bad'?C.danger:C.accent):(o.sel||o.hover?C.accent:(f.locked?C.muted:C.wall));
  const alpha=o.faded?0.35:(o.ghost?0.6:1); ctx.save();ctx.globalAlpha=alpha;ctx.translate(s.x,s.y);ctx.rotate(fr.rot*Math.PI/180);ctx.scale(z*(fr.mirror?-1:1),z);
  ctx.lineWidth=(o.sel?2:1.2)/z;ctx.strokeStyle=col;ctx.fillStyle=col;
  const isPh=!f.productId; ctx.setLineDash(isPh?[120,80]:[]);
  ctx.beginPath();l.pts.forEach((p,k)=>k?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.globalAlpha=alpha*(isPh?0.10:0.06);ctx.fill();ctx.globalAlpha=alpha;ctx.stroke();ctx.setLineDash([]);
  if(Math.max(l.w,l.h)*z>=24){ctx.lineWidth=0.8/z;(SYM[t.symbol]||SYM.generic)(ctx,l,f.dims,fo);}
  // маркер фронта
  const fy=l.h/2; ctx.lineWidth=2/z; ctx.beginPath();ctx.moveTo(-Math.min(l.w*0.15,150),fy);ctx.lineTo(Math.min(l.w*0.15,150),fy);ctx.stroke();
  ctx.restore();
  if(f.warnings?.length&&!o.ghost){label(s.x+8,s.y-8,'! '+f.warnings.map(w=>({outside:'вне комнаты',door:'мешает двери',window:'перед окном'})[w]).join(', '),C.danger);}
  if(isPh&&!o.ghost){ctx.fillStyle=C.paper;ctx.beginPath();ctx.arc(s.x,s.y,9,0,7);ctx.fill();ctx.strokeStyle=C.accent;ctx.lineWidth=1.2;ctx.stroke();ctx.fillStyle=C.accent;ctx.font='bold 12px '+cssv('--font');ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('?',s.x,s.y+0.5);ctx.textAlign='start';ctx.textBaseline='alphabetic';}
  if(f.locked&&!o.ghost)drawLock(ctx,s.x+l.w*z/2-10,s.y-l.h*z/2+4);
  if(P.showAiBadges&&f.aiPolicy&&!o.ghost&&P.mode==='furniture')drawAiBadge(ctx,s.x,s.y+l.h*z/2+12,f.aiPolicy);
}
function drawLock(ctx,x,y){ctx.save();ctx.fillStyle=C.paper;ctx.strokeStyle=C.muted;ctx.lineWidth=1.2;ctx.fillRect(x-6,y+3,12,9);ctx.strokeRect(x-6,y+3,12,9);ctx.beginPath();ctx.arc(x,y+3,4,Math.PI,0);ctx.stroke();ctx.restore();}
function furnitureAtScreen(sp){if(P.mode!=='furniture')return null;const wp=Wd(sp);const items=[...(P.furniture||[])].reverse();const layers={ontop:0,floor:1,under:2};items.sort((a,b)=>layers[TYPE.get(a.typeId).layer]-layers[TYPE.get(b.typeId).layer]);for(const f of items){const pts=fWorldOf(f,P,D);if(pts&&pointInPoly(wp,pts))return f;}return null;}
