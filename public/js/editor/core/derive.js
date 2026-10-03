'use strict';
/* furnitech · редактор · core/derive.js
   Производные данные проекта (контур, нормали, углы), проверка проекта, свободное место для проёма. Без обращения к странице.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ================= Производные данные ================= */
function derive(p){
  const V=new Map(p.vertices.map(v=>[v.id,v])); const deg=new Map(), adj=new Map();
  p.vertices.forEach(v=>{deg.set(v.id,0);adj.set(v.id,[]);});
  p.walls.forEach(w=>{deg.set(w.a,deg.get(w.a)+1);deg.set(w.b,deg.get(w.b)+1);adj.get(w.a).push(w);adj.get(w.b).push(w);});
  let cycle=null, area=0;
  if(p.vertices.length>=3&&p.walls.length===p.vertices.length&&[...deg.values()].every(d=>d===2)){
    const order=[]; let cur=p.vertices[0].id, prevW=null, guard=0;
    while(guard++<p.vertices.length+1){ order.push(cur); const w=adj.get(cur).find(x=>x!==prevW); if(!w)break; const nxt=w.a===cur?w.b:w.a; prevW=w; cur=nxt; if(cur===order[0])break; }
    if(order.length===p.vertices.length&&cur===order[0]) cycle=order;
  }
  const cyclePos=new Map(cycle?cycle.map((id,i)=>[id,i]):[]);
  if(cycle) area=shoelace(cycle.map(id=>V.get(id)));
  const os=cycle?(area>0?-1:1):1;
  const W=new Map();
  for(const w of p.walls){
    const a=V.get(w.a),b=V.get(w.b); const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1; const ux=dx/len,uy=dy/len;
    const ortho=Math.abs(dx)<0.5||Math.abs(dy)<0.5, horiz=Math.abs(dy)<0.5;
    let s=1; if(cycle){const n=cycle.length; s=((cyclePos.get(w.a)+1)%n===cyclePos.get(w.b))?1:-1;}
    const nx=-uy*s*os, ny=ux*s*os;
    const refIsA=(a.y<b.y-0.5)||(Math.abs(a.y-b.y)<=0.5&&a.x<=b.x); const ref=refIsA?a:b, oth=refIsA?b:a;
    W.set(w.id,{w,a,b,len:Math.hypot(dx,dy),ux,uy,ortho,horiz,nx,ny,ref,oth,rx:(oth.x-ref.x)/len,ry:(oth.y-ref.y)/len,refIsA});
  }
  const convex=new Map();
  if(cycle){ const n=cycle.length; for(let i=0;i<n;i++){const pv=V.get(cycle[(i-1+n)%n]),c=V.get(cycle[i]),nx=V.get(cycle[(i+1)%n]); const cr=(c.x-pv.x)*(nx.y-c.y)-(c.y-pv.y)*(nx.x-c.x); convex.set(cycle[i],Math.sign(cr)===Math.sign(area));} }
  p.closed=!!cycle;
  return {V,deg,adj,cycle,area,W,convex};
}
function freeVertices(d=D,p=P){return p.vertices.filter(v=>d.deg.get(v.id)===1);}
function wallOpenings(wid,p=P){return p.openings.filter(o=>o.wallId===wid).sort((a,b)=>a.offset-b.offset);}
function kOf(wid,d=D,p=P){const w=p.walls.find(x=>x.id===wid); if(!d.cycle)return 2; return (d.convex.get(w.a)?1:0)+(d.convex.get(w.b)?1:0);}

/* ================= Валидация ================= */
function validateProject(p){
  const d=derive(p);
  for(const [id,dg] of d.deg) if(dg>2) return 'Точка не может соединять более двух стен';
  for(const w of p.walls){const i=d.W.get(w.id); if(i.len<MIN_WALL-0.5) return `Стена короче ${fmtU(MIN_WALL)}`; if(i.len>MAX_WALL+0.5) return `Стена длиннее ${fmtU(MAX_WALL)}`;}
  const ws=p.walls;
  for(let i=0;i<ws.length;i++)for(let j=i+1;j<ws.length;j++){
    const A=d.W.get(ws[i].id),B=d.W.get(ws[j].id);
    const shared=[ws[i].a,ws[i].b].filter(v=>v===ws[j].a||v===ws[j].b);
    if(shared.length===2) return 'Две стены совпадают';
    if(shared.length===1){
      const s=d.V.get(shared[0]); const o1=ws[i].a===shared[0]?A.b:A.a, o2=ws[j].a===shared[0]?B.b:B.a;
      if(orient(s,o1,o2)===0&&dot(sub(o1,s),sub(o2,s))>0) return 'Стена продолжает предыдущую. Измените длину предыдущей стены';
    } else if(segInter(A.a,A.b,B.a,B.b)) return 'Стена пересекает другую стену';
  }
  if(ws.length>0&&!d.cycle){
    const d1=[...d.deg.values()].filter(x=>x===1).length;
    if(d1!==2||ws.length!==p.vertices.length-1) return 'Контур должен быть одной непрерывной линией';
  }
  if(ws.length>0&&ws.length===p.vertices.length&&!d.cycle) return 'Контур должен быть одной непрерывной линией';
  for(const o of p.openings){
    const i=d.W.get(o.wallId); if(!i) return 'Проём без стены';
    if(o.offset<-0.5) return `${o.name}: отступ не может быть отрицательным`;
    if(o.offset+o.width>i.len+0.5) return `${o.name}: не помещается на стене (стена ${fmtU(i.len)})`;
    if(o.height>p.wallHeight+0.5) return `${o.name}: выше стены`;
    if(o.kind==='window'){ if(o.sill<0) return `${o.name}: «от пола» < 0`; if(o.sill+o.height>p.wallHeight+0.5) return `${o.name}: не помещается по высоте (max ${fmtU(p.wallHeight-o.sill)})`; }
    if(o.kind==='arch'){ if(o.radius<0||o.radius>o.width/2+0.5) return `${o.name}: радиус 0…${fmtU(o.width/2)}`; if(o.radius>o.height) return `${o.name}: радиус больше высоты`; }
    for(const q of p.openings){ if(q===o||q.wallId!==o.wallId)continue; if(o.offset<q.offset+q.width-0.5&&q.offset<o.offset+o.width-0.5) return `${o.name} пересекает ${q.name}`; }
  }
  if(p.mode==='furniture'){const fe=validateFurniture(p,d); if(fe)return fe;}
  return null;
}
function fitOffset(info,width,desired,excludeId,p=P){
  const ex=excludeId instanceof Set?excludeId:new Set(excludeId==null?[]:[excludeId]);
  const occ=wallOpenings(info.w.id,p).filter(o=>!ex.has(o.id)); let s=0; const gaps=[];
  for(const o of occ){ if(o.offset-s>=width-0.5) gaps.push([s,o.offset]); s=o.offset+o.width; }
  if(info.len-s>=width-0.5) gaps.push([s,info.len]);
  let best=null,bd=Infinity; for(const [g0,g1] of gaps){const c=Math.max(g0,Math.min(desired,g1-width)); const dd=Math.abs(c-desired); if(dd<bd){bd=dd;best=c;}}
  return best===null?null:Math.round(best);
}

/* ---------- Внутренний контур комнаты ---------- */
function innerPoly(){return D.cycle?D.cycle.map(id=>D.V.get(id)):null;}
function pointInPoly(p,poly){let ins=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)ins=!ins;}return ins;}
function distToWalls(p){let m=Infinity;for(const w of P.walls){const i=D.W.get(w.id);m=Math.min(m,distPtSeg(p,i.a,i.b));}return m;}
function polyCentroid(poly){let A=0,cx=0,cy=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];const f=a.x*b.y-b.x*a.y;A+=f;cx+=(a.x+b.x)*f;cy+=(a.y+b.y)*f;}A/=2;if(Math.abs(A)<1e-6){return {x:poly.reduce((s,p)=>s+p.x,0)/poly.length,y:poly.reduce((s,p)=>s+p.y,0)/poly.length};}return {x:cx/(6*A),y:cy/(6*A)};}
