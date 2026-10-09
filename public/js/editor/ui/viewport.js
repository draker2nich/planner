'use strict';
/* furnitech · редактор · ui/viewport.js
   Вид плана: масштаб и панорама; помощники DOM.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ================= Viewport ================= */
const vp=()=>P.viewport;
const S=(w)=>({x:w.x*vp().zoom+vp().x,y:w.y*vp().zoom+vp().y});
const Wd=(s)=>({x:(s.x-vp().x)/vp().zoom,y:(s.y-vp().y)/vp().zoom});
function roomBox(){ if(!P.vertices.length) return {x:-2500,y:-2500,w:5000,h:5000}; let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity; for(const v of P.vertices){x0=Math.min(x0,v.x);y0=Math.min(y0,v.y);x1=Math.max(x1,v.x);y1=Math.max(y1,v.y);} const m=P.wallThickness; return {x:x0-m,y:y0-m,w:x1-x0+2*m,h:y1-y0+2*m}; }
function worldBox(){const r=roomBox();return {x:r.x-EDITOR_MARGIN,y:r.y-EDITOR_MARGIN,w:r.w+2*EDITOR_MARGIN,h:r.h+2*EDITOR_MARGIN};}
function zoomMin(){const b=worldBox();return Math.min(E.W/b.w,E.H/b.h);}
function setView(x,y,zoom){
  zoom=Math.max(zoomMin(),Math.min(ZOOM_MAX,zoom));
  const b=worldBox(); const cx=(E.W/2-x)/zoom, cy=(E.H/2-y)/zoom;
  const ccx=Math.max(b.x,Math.min(b.x+b.w,cx)), ccy=Math.max(b.y,Math.min(b.y+b.h,cy));
  P.viewport={x:E.W/2-ccx*zoom,y:E.H/2-ccy*zoom,zoom}; save();
}
function zoomAt(sx,sy,factor){const w=Wd({x:sx,y:sy}); const z=Math.max(zoomMin(),Math.min(ZOOM_MAX,vp().zoom*factor)); setView(sx-w.x*z,sy-w.y*z,z); render();}
function fitRoom(){const r=roomBox(); const z=Math.min(E.W/(r.w*1.2),E.H/(r.h*1.2)); setView(E.W/2-(r.x+r.w/2)*z,E.H/2-(r.y+r.h/2)*z,z); render();}

/* ================= UI helpers ================= */
const $=(s)=>document.querySelector(s);
const IS_TOUCH=matchMedia('(pointer:coarse)').matches; const MQ_PHONE=matchMedia('(max-width:640px)');
function h(tag,attrs={},...kids){const el=document.createElement(tag);for(const k in attrs){if(k==='class')el.className=attrs[k];else if(k.startsWith('on'))el.addEventListener(k.slice(2),attrs[k]);else el.setAttribute(k,attrs[k]);}for(const c of kids){if(c==null)continue;el.appendChild(typeof c==='string'?document.createTextNode(c):c);}return el;}
