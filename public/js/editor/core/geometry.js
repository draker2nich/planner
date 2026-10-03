'use strict';
/* furnitech · редактор · core/geometry.js
   Геометрия: векторы, пересечения, расстояния, площадь. Чистые функции.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ================= Геометрия ================= */
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y}), dot=(a,b)=>a.x*b.x+a.y*b.y, hyp=(a)=>Math.hypot(a.x,a.y);
function orient(a,b,c){const v=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); return Math.abs(v)<1e-6?0:(v>0?1:-1);}
function onSeg(a,b,c){return Math.min(a.x,b.x)-1e-6<=c.x&&c.x<=Math.max(a.x,b.x)+1e-6&&Math.min(a.y,b.y)-1e-6<=c.y&&c.y<=Math.max(a.y,b.y)+1e-6;}
function segInter(p1,p2,p3,p4){
  const o1=orient(p1,p2,p3),o2=orient(p1,p2,p4),o3=orient(p3,p4,p1),o4=orient(p3,p4,p2);
  if(o1!==o2&&o3!==o4) return true;
  if(o1===0&&onSeg(p1,p2,p3))return true; if(o2===0&&onSeg(p1,p2,p4))return true;
  if(o3===0&&onSeg(p3,p4,p1))return true; if(o4===0&&onSeg(p3,p4,p2))return true; return false;
}
function distPtSeg(p,a,b){const ab=sub(b,a),L2=dot(ab,ab); if(L2<1e-9)return hyp(sub(p,a)); let t=dot(sub(p,a),ab)/L2; t=Math.max(0,Math.min(1,t)); return hyp(sub(p,{x:a.x+ab.x*t,y:a.y+ab.y*t}));}
function shoelace(pts){let s=0;for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];s+=a.x*b.y-b.x*a.y;}return s/2;}
function lineInter(p,d,q,e){const den=d.x*e.y-d.y*e.x; if(Math.abs(den)<1e-9)return null; const t=((q.x-p.x)*e.y-(q.y-p.y)*e.x)/den; return {x:p.x+d.x*t,y:p.y+d.y*t};}
function rectsOverlap(a,b,pad=0){return a.x<b.x+b.w+pad&&a.x+a.w+pad>b.x&&a.y<b.y+b.h+pad&&a.y+a.h+pad>b.y;}
function rectSegInter(r,a,b){
  if(a.x>=r.x&&a.x<=r.x+r.w&&a.y>=r.y&&a.y<=r.y+r.h)return true;
  const c=[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}];
  for(let i=0;i<4;i++) if(segInter(a,b,c[i],c[(i+1)%4]))return true; return false;
}
