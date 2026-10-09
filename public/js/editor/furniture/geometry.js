'use strict';
/* furnitech · редактор · furniture/geometry.js
   Каталог в памяти, габариты мебели, посадка к стене, проверка расстановки. Страница нужна только внутри функций.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* =====================================================================
   Правки C–D и Этап 2 — замок, режим мебели, каталог, символы, 3D‑мебель
   ===================================================================== */
/* Категории и формы — public/shared/catalog-types.js. Товары — с сервера (/api/catalog/products).
   Демо‑набор (выдуманные товары) подставляется только там, где сервера нет вовсе: страница открыта файлом с диска.
   На сайте до загрузки каталог пуст: показывать посетителю несуществующие товары с ценами нельзя.
   CATALOG_SOURCE: 'demo' | 'loading' | 'server' | 'error'. */
const CATALOG_OFFLINE=location.protocol==='file:';
let PRODUCTS=CATALOG_OFFLINE?demoProducts():[]; let PRODUCT_BY_ID=new Map(PRODUCTS.map(p=>[p.id,p])); let CATALOG_SOURCE=CATALOG_OFFLINE?'demo':'loading';
function setProducts(list,src){PRODUCTS=list;PRODUCT_BY_ID=new Map(list.map(p=>[p.id,p]));CATALOG_SOURCE=src;}
let catalogTries=0;
async function loadCatalog(){
  if(CATALOG_OFFLINE)return;
  const refresh=()=>{if(typeof T3!=='undefined'&&T3.active)T3.dirty=true;if(typeof buildCatalog==='function'&&P&&P.mode==='furniture'&&!E.dialogOpen)buildCatalog();render();};
  if(CATALOG_SOURCE==='error'){CATALOG_SOURCE='loading';refresh();}
  /* порциями: тысячи товаров одним ответом не помещаются в предел ответа функции Vercel (4,5 МБ) */
  try{let all=[],off=0;for(;;){const r=await fetch('api/catalog/products?limit=2000&offset='+off,{headers:{Accept:'application/json'}});if(!r.ok)throw new Error(r.status);const j=await r.json();all=all.concat(j.products||[]);if(j.next==null||!(j.next>off))break;off=j.next;}setProducts(all,'server');
    refresh();
  }catch(e){
    console.warn('Каталог не загрузился',e);
    if(CATALOG_SOURCE!=='server'){CATALOG_SOURCE='error';refresh();}
    /* одна повторная попытка сама (сбой сети часто минутный); дальше — кнопка «Повторить» в панели каталога */
    if(++catalogTries<2)setTimeout(loadCatalog,4000);
  }
}
const mountOf=(t,f)=>f.mount||t.mount;

/* ---------- Габарит (локальные координаты, фронт = +y) ---------- */
function fpPoly(fp,d){
  const P2=(x,y)=>({x,y}); let pts=[];
  const W=d.W??d.A??d.DIA??500, Dd=d.D??d.L??d.DIA??500;
  if(fp==='rect'){pts=[P2(0,0),P2(W,0),P2(W,Dd),P2(0,Dd)];}
  else if(fp==='square'){pts=[P2(0,0),P2(W,0),P2(W,W),P2(0,W)];}
  else if(fp==='circle'){const r=(d.DIA||W)/2;for(let i=0;i<32;i++)pts.push(P2(r+r*Math.cos(i/32*Math.PI*2),r+r*Math.sin(i/32*Math.PI*2)));}
  else if(fp==='ellipse'){for(let i=0;i<32;i++)pts.push(P2(W/2+W/2*Math.cos(i/32*Math.PI*2),Dd/2+Dd/2*Math.sin(i/32*Math.PI*2)));}
  else if(fp==='L'){const A=d.A,B=d.B,D2=Math.min(d.D,A,B);pts=[P2(0,0),P2(A,0),P2(A,B),P2(A-D2,B),P2(A-D2,D2),P2(0,D2)];}
  else if(fp==='U'){const A=d.A,B=d.B,D2=Math.min(d.D,A/2,B);pts=[P2(0,0),P2(A,0),P2(A,B),P2(A-D2,B),P2(A-D2,D2),P2(D2,D2),P2(D2,B),P2(0,B)];}
  else if(fp==='quarter'){const r=d.R;pts=[P2(0,0),P2(r,0)];for(let i=1;i<12;i++){const a=i/12*Math.PI/2;pts.push(P2(r*Math.cos(a),r*Math.sin(a)));}pts.push(P2(0,r));}
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;pts.forEach(p=>{x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y);});
  const cx=(x0+x1)/2,cy=(y0+y1)/2; return {pts:pts.map(p=>P2(p.x-cx,p.y-cy)),w:x1-x0,h:y1-y0};
}
function fLocal(f){const t=TYPE.get(f.typeId);const fo=formOf(t,f.formId);return fpPoly(fo.fp,f.dims);}
function fWorld(f){const l=fLocal(f);const r=f.rot*Math.PI/180,c=Math.cos(r),s=Math.sin(r),m=f.mirror?-1:1;return l.pts.map(p=>({x:f.x+(p.x*m)*c-p.y*s,y:f.y+(p.x*m)*s+p.y*c}));}
function aabbOf(pts){let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;pts.forEach(p=>{x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y);});return {x0,y0,x1,y1,w:x1-x0,h:y1-y0,cx:(x0+x1)/2,cy:(y0+y1)/2};}
function shrink(pts,mm){const c=aabbOf(pts);return pts.map(p=>{const dx=p.x-c.cx,dy=p.y-c.cy,L=Math.hypot(dx,dy)||1;return {x:p.x-dx/L*mm,y:p.y-dy/L*mm};});}
function segCross(p1,p2,p3,p4){const o=(a,b,c)=>{const v=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);return Math.abs(v)<1?0:Math.sign(v);};const o1=o(p1,p2,p3),o2=o(p1,p2,p4),o3=o(p3,p4,p1),o4=o(p3,p4,p2);return o1*o2<0&&o3*o4<0;}
function polyIntersect(A0,B0){const A=shrink(A0,1),B=shrink(B0,1);for(let i=0;i<A.length;i++)for(let j=0;j<B.length;j++)if(segCross(A[i],A[(i+1)%A.length],B[j],B[(j+1)%B.length]))return true;return A.some(q=>pointInPoly(q,B0))||B.some(q=>pointInPoly(q,A0));}
function insideRoom(pts,p=P,d=D){const poly=d.cycle?d.cycle.map(id=>d.V.get(id)):null;if(!poly)return false;const s=shrink(pts,2);if(!s.every(q=>pointInPoly(q,poly)))return false;for(const w of p.walls){const i=d.W.get(w.id);for(let k=0;k<s.length;k++)if(segCross(s[k],s[(k+1)%s.length],i.a,i.b))return false;}return true;}
function fWorldOf(f,p,d){ // для валидации на клоне
  const t=TYPE.get(f.typeId);const fo=formOf(t,f.formId);const mt=mountOf(t,fo);
  if(mt==='wall'){const i=d.W.get(f.wallId);if(!i)return null;const c={x:i.ref.x+i.rx*(f.offset+f.dims.W/2),y:i.ref.y+i.ry*(f.offset+f.dims.W/2)};const r=Math.atan2(i.nx,-i.ny);const dd=f.dims.D;const cx=c.x-i.nx*dd/2,cy=c.y-i.ny*dd/2;const l=fpPoly(fo.fp,f.dims);const cs=Math.cos(r),sn=Math.sin(r);return l.pts.map(q=>({x:cx+q.x*cs-q.y*sn,y:cy+q.x*sn+q.y*cs}));}
  return fWorld(f);
}
function doorZones(p=P,d=D){const z=[];for(const o of p.openings){if(o.kind!=='door')continue;const i=d.W.get(o.wallId);if(!i)continue;const hingeA=o.hinge==='left'?o.offset:o.offset+o.width;const hp={x:i.ref.x+i.rx*hingeA,y:i.ref.y+i.ry*hingeA};const dirA=o.hinge==='left'?1:-1;const inward=o.swing==='in'?-1:1;const ax={x:i.rx*dirA,y:i.ry*dirA},ay={x:i.nx*inward,y:i.ny*inward};if(inward>0)continue;const pts=[hp];for(let k=0;k<=8;k++){const a=k/8*Math.PI/2;pts.push({x:hp.x+(ax.x*Math.cos(a)+ay.x*Math.sin(a))*o.width,y:hp.y+(ax.y*Math.cos(a)+ay.y*Math.sin(a))*o.width});}z.push({name:o.name,pts});}return z;}
function windowZones(p=P,d=D){const z=[];for(const o of p.openings){if(o.kind!=='window')continue;const i=d.W.get(o.wallId);if(!i)continue;const a={x:i.ref.x+i.rx*o.offset,y:i.ref.y+i.ry*o.offset},b={x:i.ref.x+i.rx*(o.offset+o.width),y:i.ref.y+i.ry*(o.offset+o.width)};const n={x:-i.nx*300,y:-i.ny*300};z.push({name:o.name,sill:o.sill||0,pts:[a,b,{x:b.x+n.x,y:b.y+n.y},{x:a.x+n.x,y:a.y+n.y}]});}return z;}
function furnitureWarnings(f,p=P,d=D){const w=[];const pts=fWorldOf(f,p,d);if(!pts)return ['outside'];const t=TYPE.get(f.typeId);const mt=mountOf(t,formOf(t,f.formId));if((mt==='floor'||mt==='ceiling')&&!insideRoom(pts,p,d))w.push('outside');if(mt==='floor'){for(const z of doorZones(p,d))if(polyIntersect(pts,z.pts)){w.push('door');break;}/* перед окном мешает только то, что выше подоконника: низкая тумба или пуф окно не загораживают */
  const hgt=f.dims.H||0;for(const z of windowZones(p,d))if(hgt>z.sill+0.5&&polyIntersect(pts,z.pts)){w.push('window');break;}}return w;}
function validateFurniture(p,d){
  if(!d.cycle)return null; const items=p.furniture||[]; const polys=new Map(); const strict=p._strict?new Set(p._strict):null; const chk=(f)=>strict?strict.has(f.id):!(f.warnings||[]).includes('outside');
  for(const f of items){const t=TYPE.get(f.typeId);if(!t)return `${f.name}: неизвестный тип`;const pts0=fWorldOf(f,p,d);if(!pts0)return `${f.name}: стена не найдена`;polys.set(f.id,pts0);if(!chk(f))continue;const fo=formOf(t,f.formId);const mt=mountOf(t,fo);const pts=pts0;
    if(mt==='wall'){const i=d.W.get(f.wallId);if(f.offset<-0.5||f.offset+f.dims.W>i.len+0.5)return `${f.name}: не помещается на стене`;}
    else if(mt==='ontop'){const b=items.find(x=>x.id===f.baseId);if(!b)return `${f.name}: нет основания`;const bb=aabbOf(fWorldOf(b,p,d)),aa=aabbOf(pts);if(aa.x0<bb.x0-1||aa.x1>bb.x1+1||aa.y0<bb.y0-1||aa.y1>bb.y1+1)return `${f.name}: выходит за пределы основания`;}
    else if(!insideRoom(pts,p,d))return `${f.name}: вне комнаты или в стене`;
    if(f.productId){const pr=PRODUCT_BY_ID.get(f.productId);if(pr)for(const k in pr.dims)if(k!=='E'&&Math.abs((f.dims[k]||0)-pr.dims[k])>0.5)return `${f.name}: размеры товара фиксированы`;}
  }
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){const a=items[i],b=items[j];if(!chk(a)&&!chk(b))continue;const la=TYPE.get(a.typeId).layer,lb=TYPE.get(b.typeId).layer;const ma=mountOf(TYPE.get(a.typeId),formOf(TYPE.get(a.typeId),a.formId)),mb=mountOf(TYPE.get(b.typeId),formOf(TYPE.get(b.typeId),b.formId));
    let check=false;if(ma==='floor'&&mb==='floor'&&la==='floor'&&lb==='floor')check=true;if(ma==='ontop'&&mb==='ontop'&&a.baseId===b.baseId)check=true;if(ma==='wall'&&mb==='wall'&&a.wallId===b.wallId)check=true;if(ma==='ceiling'&&mb==='ceiling')check=true;
    if(check&&polyIntersect(polys.get(a.id),polys.get(b.id)))return `${a.name} пересекает ${b.name}`;}
  return null;
}
