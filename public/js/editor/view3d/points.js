'use strict';
/* furnitech · редактор · view3d/points.js
   Состояние 3D, точки обзора, пол и точки на плане.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* =====================================================================
   Этап 1.1 / 1.2 — точки обзора, 3D‑режим, материалы
   ===================================================================== */
const T3={active:false,ready:false,scene:null,camera:null,renderer:null,room:null,pickables:[],arrows:[],point:0,yaw:0,pitch:0,fov:70,moving:null,sel:null,outline:null,dirty:false,models:{},raf:0,drag:null,libTex:new Map(),photoTex:new Map(),avg:new Map(),panelTarget:null};
const hasWebGL=(()=>{try{const c=document.createElement('canvas');return !!(c.getContext('webgl2')||c.getContext('webgl'));}catch(e){return false;}})();
const FLOOR_DEF='#d9cfbf', WALL_DEF='#e9e6df', CEIL_DEF='#f4f4f2', EXT_COL='#9a9a94';

/* ---------- Точки обзора ---------- */
const VP={key:null,points:[]};
function getViewPoints(){
  const key=P.closed?P.vertices.map(v=>v.x+','+v.y).join(';'):'';
  if(key===VP.key)return VP.points; VP.key=key; VP.points=[]; if(!P.closed)return VP.points;
  const poly=innerPoly(); const xs=[...new Set(P.vertices.map(v=>v.x))].sort((a,b)=>a-b), ys=[...new Set(P.vertices.map(v=>v.y))].sort((a,b)=>a-b);
  const cells=[]; for(let i=0;i<xs.length-1;i++)for(let j=0;j<ys.length-1;j++){const c={x:xs[i],y:ys[j],w:xs[i+1]-xs[i],h:ys[j+1]-ys[j]};if(pointInPoly({x:c.x+c.w/2,y:c.y+c.h/2},poly))cells.push(c);}
  let zones=cells.filter(c=>c.w>=1000&&c.h>=1000); if(!zones.length&&cells.length)zones=[cells.reduce((a,b)=>a.w*a.h>=b.w*b.h?a:b)];
  let pts=[]; const M=800;
  if(zones.length===1){const z=zones[0];const axis=(size,c)=>{const s=(size-2*M)/2;return size-2*M<1200?[c]:[c-s,c,c+s];};for(const y of axis(z.h,z.y+z.h/2))for(const x of axis(z.w,z.x+z.w/2))pts.push({x,y});}
  else{const split=(z)=>{if(z.w>5000){split({x:z.x,y:z.y,w:z.w/2,h:z.h});split({x:z.x+z.w/2,y:z.y,w:z.w/2,h:z.h});return;}if(z.h>5000){split({x:z.x,y:z.y,w:z.w,h:z.h/2});split({x:z.x,y:z.y+z.h/2,w:z.w,h:z.h/2});return;}pts.push({x:z.x+z.w/2,y:z.y+z.h/2});};zones.forEach(split);}
  pts=pts.filter(p=>pointInPoly(p,poly)&&distToWalls(p)>=600);
  if(!pts.length){const c=polyCentroid(poly);pts.push(c);}
  pts.sort((a,b)=>a.y-b.y||a.x-b.x);
  const vis=(p,q)=>{for(const w of P.walls){const i=D.W.get(w.id);if(segInter(p,q,i.a,i.b))return false;}for(let t=0.1;t<0.95;t+=0.1){if(distToWalls({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t})<300)return false;}return true;};
  VP.points=pts.map((p,i)=>({index:i,x:Math.round(p.x),y:Math.round(p.y),neighbors:{}}));
  for(const a of VP.points){const best={};for(const b of VP.points){if(a===b)continue;const dx=b.x-a.x,dy=b.y-a.y;const sec=Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up');const d=Math.hypot(dx,dy);if(!vis(a,b))continue;if(!best[sec]||d<best[sec].d)best[sec]={d,i:b.index};}for(const s in best)a.neighbors[s]=best[s].i;}
  return VP.points;
}
function togglePoints(){P.viewPointsVisible=!P.viewPointsVisible;save();updateTools();render();if(T3.active){$('#btnPoints3d').classList.toggle('on',P.viewPointsVisible);$('#btnPoints3d').setAttribute('aria-pressed',String(P.viewPointsVisible));buildArrows();}}
function nearestPointTo(p){const pts=getViewPoints();let b=0,bd=Infinity;pts.forEach(q=>{const d=Math.hypot(q.x-p.x,q.y-p.y);if(d<bd){bd=d;b=q.index;}});return b;}

/* ---------- Отрисовка точек и пола в плане ---------- */
function drawFloorPlan(ctx){
  const poly=innerPoly(); if(!poly)return; ctx.save(); ctx.fillStyle=C.bg; ctx.beginPath(); poly.map(S).forEach((p,k)=>k?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.closePath(); ctx.fill(); ctx.globalAlpha=0.35; ctx.fillStyle=floorPlanColor(); ctx.beginPath(); poly.map(S).forEach((p,k)=>k?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.closePath(); ctx.fill(); ctx.restore();
  if(E.sel?.type==='floor'){ctx.strokeStyle=C.accent;ctx.lineWidth=2;ctx.setLineDash([6,4]);ctx.beginPath();poly.map(S).forEach((p,k)=>k?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.stroke();ctx.setLineDash([]);}
}
function drawViewPointsPlan(ctx){
  if(!P.closed||!P.viewPointsVisible)return; const pts=getViewPoints(); const hov=E.hover&&E.hover.startsWith('viewpoint')?+E.hover.slice(9):-1;
  for(const p of pts){const s=S(p); const cur=T3.active&&T3.point===p.index; const isH=hov===p.index;
    if(isH){ctx.setLineDash([3,4]);ctx.strokeStyle=C.accent;ctx.lineWidth=1;for(const k in p.neighbors){const q=S(pts[p.neighbors[k]]);ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(q.x,q.y);ctx.stroke();}ctx.setLineDash([]);}
    ctx.fillStyle=cur||isH?C.accent:C.paper; ctx.strokeStyle=hasWebGL?C.accent:C.muted; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(s.x,s.y,7,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle=cur||isH?'#fff':(hasWebGL?C.accent:C.muted); ctx.beginPath(); ctx.arc(s.x,s.y,2.2,0,Math.PI*2); ctx.fill();
    if(isH){label(s.x+12,s.y-10,hasWebGL?`Войти в 3D (точка ${p.index+1})`:'3D недоступно в этом браузере',C.fg);} }
}
function viewPointAtScreen(sp){if(!P.closed||!P.viewPointsVisible)return null;for(const p of getViewPoints()){if(hyp(sub(S(p),sp))<=10)return p;}return null;}
function floorPlanColor(){const m=P.floor?.material;if(!m)return FLOOR_DEF;if(m.type==='color')return m.color;const k=m.type==='texture'?'t:'+m.textureId:'p:'+m.photoId;if(T3.avg.has(k))return T3.avg.get(k);if(m.type==='texture'){const c=getLibCanvas(m.textureId);if(c){const a=avgOfCanvas(c);T3.avg.set(k,a);return a;}}else{getPhotoTexture(m.photoId).then(t=>{if(t){const cv2=document.createElement('canvas');cv2.width=cv2.height=16;cv2.getContext('2d').drawImage(t.image,0,0,16,16);T3.avg.set(k,avgOfCanvas(cv2));render();}});}return FLOOR_DEF;}
function avgOfCanvas(c){const s=8;const cv2=document.createElement('canvas');cv2.width=cv2.height=s;const x=cv2.getContext('2d');x.drawImage(c,0,0,s,s);const d=x.getImageData(0,0,s,s).data;let r=0,g=0,b=0;for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2];}const n=d.length/4;return '#'+[r,g,b].map(v=>Math.round(v/n).toString(16).padStart(2,'0')).join('');}
function matName(m){if(!m||m.type==='color')return 'Цвет '+(m?.color||WALL_DEF);if(m.type==='texture')return (TEXLIB.find(t=>t.id===m.textureId)?.name)||'Текстура';return 'Фото';}
