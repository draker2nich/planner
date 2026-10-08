'use strict';
/* furnitech · редактор · ai/place.js
   ИИ‑дизайнер: геометрия. Перевод «способов постановки» из ответа модели в координаты, проверка, доводка,
   подбор места программой, сохранение привязки при замене товара. Без обращения к странице и к сети.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html.

   Модель не называет координаты: она говорит «у стены W2 с отступом 300», «рядом с i4 слева», «по центру под i1».
   Здесь это превращается в положение предмета и проверяется теми же правилами, что и ручная расстановка
   (validateFurniture), плюс правилами, которые обязательны только для ИИ: не закрывать двери и проходы,
   не ставить высокое перед окном, не вешать предмет поверх проёма или внутрь мебели. */

const AI_PASSAGE=800;   // свободная зона перед дверью и аркой, мм
const AI_WALL_EPS=50;   // предмет «стоит спиной к стене», если его тыл не дальше этого от стены, мм
const AI_SEATS=['chair','bar-stool','office-chair','armchair','pouf','beanbag','bench'];
const AI_TABLES=['table','desk','meeting-table','bar-counter','island','dressing-table','coffee-table','small-table','kitchen-base','closet-island'];
/* то, что обычно стоит не у стены: место для них программа ищет сначала рядом с задуманным, а не вдоль стен */
const AI_CENTRAL=['table','coffee-table','chair','bar-stool','office-chair','pouf','beanbag','island','closet-island','meeting-table','small-table','armchair'];
/* формы, которые ИИ‑дизайнер не передвигает: четверть круга стоит только в углу и только одним способом */
const AI_FIXED_FP=['quarter'];
const AI_FACE={down:0,left:90,up:180,right:270};

/* ---------- вид предмета и его положение ---------- */
function aiMount(f){const t=TYPE.get(f.typeId);return mountOf(t,formOf(t,f.formId));}
/* floor — на полу, rug — ковёр (под мебелью), wall — на стене, ceiling — на потолке, ontop — стоит на другом предмете */
function aiKind(f){const m=aiMount(f);return m==='wall'?'wall':m==='ceiling'?'ceiling':m==='ontop'?'ontop':TYPE.get(f.typeId).layer==='under'?'rug':'floor';}
function aiExt(f){const l=fLocal(f);return {w:l.w,d:l.h};}
const aiNorm=(deg)=>((Math.round(deg*100)/100)%360+360)%360;
/* оси предмета в плане: ax — вдоль ширины, ay — куда смотрит лицо */
const aiAxes=(rot)=>{const r=rot*Math.PI/180,c=Math.cos(r),s=Math.sin(r);return {ax:{x:c,y:s},ay:{x:-s,y:c}};};
/* поворот, при котором лицо предмета смотрит вдоль v */
const aiRotFacing=(v)=>aiNorm(Math.atan2(-v.x,v.y)*180/Math.PI);
const aiWallRot=(i)=>aiNorm(Math.atan2(i.nx,-i.ny)*180/Math.PI);
function aiFaceOf(rot){const r=aiNorm(rot);return r<45||r>=315?'down':r<135?'left':r<225?'up':'right';}
/* центр, поворот и габарит предмета в плане — одинаково для напольных и настенных */
function aiFrame(f,d){
  if(aiMount(f)==='wall'){const i=d.W.get(f.wallId);if(!i)return null;const along=f.offset+f.dims.W/2;return {x:i.ref.x+i.rx*along-i.nx*f.dims.D/2,y:i.ref.y+i.ry*along-i.ny*f.dims.D/2,rot:aiWallRot(i),w:f.dims.W,d:f.dims.D};}
  const e=aiExt(f);return {x:f.x,y:f.y,rot:f.rot,w:e.w,d:e.d};
}
const aiDefElev=(f)=>f.elev??f.dims.E??0;
/* Стена, к которой предмет стоит спиной: тыл параллелен стене и не дальше AI_WALL_EPS от неё */
function aiBackWall(f,d,Q){
  const e=aiExt(f);let best=null;
  for(const w of Q.walls){const i=d.W.get(w.id);const dr=Math.abs(aiNorm(f.rot)-aiWallRot(i));if(Math.min(dr,360-dr)>1)continue;
    const c=sub(f,i.ref);const gap=-(c.x*i.nx+c.y*i.ny)-e.d/2;if(gap<-5||gap>AI_WALL_EPS)continue;
    const off=c.x*i.rx+c.y*i.ry-e.w/2;if(off<-5||off+e.w>i.len+5)continue;
    if(!best||gap<best.gap)best={wallId:w.id,offset:off,gap:Math.max(0,gap),info:i};}
  return best;
}
/* Координаты — до сотых миллиметра: округление до целого сдвигало узкий длинный предмет (шкаф 2400×605) на полмиллиметра в стену */
const aiR2=(v)=>Math.round(v*100)/100;
function aiWallFrame(i,e,off,gap){const along=off+e.w/2,back=(gap||0)+e.d/2;return {x:aiR2(i.ref.x+i.rx*along-i.nx*back),y:aiR2(i.ref.y+i.ry*along-i.ny*back),rot:aiWallRot(i),_wall:i.w.id,_off:off,_gap:gap||0};}
function aiApplyFrame(f,fr,d){
  if(aiMount(f)==='wall'){f.wallId=fr.wallId;f.offset=fr.offset;f.elev=fr.elev;const c=aiFrame(f,d);if(c){f.x=c.x;f.y=c.y;f.rot=c.rot;}return f;}
  f.x=fr.x;f.y=fr.y;f.rot=fr.rot;return f;
}
const aiFrameOfItem=(f)=>aiMount(f)==='wall'?{wallId:f.wallId,offset:f.offset,elev:f.elev??0}:{x:f.x,y:f.y,rot:f.rot};

/* ---------- обстановка: комната, обозначения стен, запретные зоны ---------- */
function aiPassZones(p,d){const z=[];for(const o of p.openings){if(o.kind==='window')continue;const i=d.W.get(o.wallId);if(!i)continue;
  const a={x:i.ref.x+i.rx*o.offset,y:i.ref.y+i.ry*o.offset},b={x:i.ref.x+i.rx*(o.offset+o.width),y:i.ref.y+i.ry*(o.offset+o.width)},n={x:-i.nx*AI_PASSAGE,y:-i.ny*AI_PASSAGE};
  z.push({name:o.name,pts:[a,b,{x:b.x+n.x,y:b.y+n.y},{x:a.x+n.x,y:a.y+n.y}]});}return z;}
/* Точка «центр комнаты»: центр масс контура, а если он снаружи (комната буквой Г) — самая просторная точка внутри */
function aiRoomCentre(poly,bb){
  const c=polyCentroid(poly);const dist=(p)=>{let m=Infinity;for(let k=0;k<poly.length;k++)m=Math.min(m,distPtSeg(p,poly[k],poly[(k+1)%poly.length]));return m;};
  if(pointInPoly(c,poly)&&dist(c)>300)return {x:Math.round(c.x),y:Math.round(c.y)};
  let best=c,bd=-1;const n=24;for(let a=1;a<n;a++)for(let b=1;b<n;b++){const p={x:bb.x0+bb.w*a/n,y:bb.y0+bb.h*b/n};if(!pointInPoly(p,poly))continue;const dd=dist(p);if(dd>bd){bd=dd;best=p;}}
  return {x:Math.round(best.x),y:Math.round(best.y)};
}
/* p — проект или его часть с комнатой: vertices, walls, openings, wallHeight */
function aiCtx(p){
  const Q={vertices:p.vertices,walls:p.walls,openings:p.openings,wallHeight:p.wallHeight,mode:'furniture',furniture:[]};
  const d=derive(Q);if(!d.cycle)return null;
  const poly=d.cycle.map(id=>d.V.get(id)),bb=aabbOf(poly);
  const walls=[];const n=d.cycle.length;
  for(let k=0;k<n;k++){const a=d.cycle[k],b=d.cycle[(k+1)%n];const w=Q.walls.find(x=>(x.a===a&&x.b===b)||(x.a===b&&x.b===a));if(w)walls.push(d.W.get(w.id));}
  const wallAlias=new Map(),wallId=new Map();walls.forEach((i,k)=>{wallAlias.set(i.w.id,'W'+(k+1));wallId.set('W'+(k+1),i.w.id);});
  const zone=(list)=>list.map(z=>Object.assign(z,{bb:aabbOf(z.pts)}));
  return {Q,d,poly,bb,ox:Math.round(bb.x0),oy:Math.round(bb.y0),walls,wallAlias,wallId,centre:aiRoomCentre(poly,bb),
    zones:{door:zone(doorZones(Q,d)),pass:zone(aiPassZones(Q,d)),win:zone(windowZones(Q,d))},polys:new Map(),byAlias:new Map(),alias:new Map(),ready:new Set()};
}

/* ---------- проверка ---------- */
/* Контур предмета в плане с памятью: при переборе положений одного предмета контуры соседей не пересчитываются */
function aiPts(f,ctx){
  const dm=f.dims,sig=(aiMount(f)==='wall'?`w|${f.wallId}|${f.offset}`:`${f.x}|${f.y}|${f.rot}|${f.mirror?1:0}`)+`|${f.formId}|${dm.W}|${dm.D}|${dm.L}|${dm.A}|${dm.B}|${dm.R}|${dm.DIA}`;
  const c=ctx.polys.get(f.id);if(c&&c.f===f&&c.sig===sig)return c;
  const pts=fWorldOf(f,ctx.Q,ctx.d);const r={f,sig,pts,bb:pts?aabbOf(pts):null};ctx.polys.set(f.id,r);return r;
}
const aiApart=(a,b)=>a.x1<b.x0-1||b.x1<a.x0-1||a.y1<b.y0-1||b.y1<a.y0-1;
const aiHits=(a,b)=>!!(a.pts&&b.pts)&&!aiApart(a.bb,b.bb)&&polyIntersect(a.pts,b.pts);
/* Нарушения, обязательные только для ИИ. placed — уже поставленные предметы. */
function aiIssues(f,placed,ctx){
  const {Q,d,zones}=ctx;const kind=aiKind(f),out=[],h=f.dims.H||0;
  if(kind==='wall'){
    const i=d.W.get(f.wallId);if(!i)return ['no_room'];const el=f.elev??0;
    if(el<-0.5||el+h>Q.wallHeight+0.5)out.push('height');
    if(f.typeId!=='curtain')for(const o of Q.openings){if(o.wallId!==f.wallId||!(f.offset<o.offset+o.width-0.5&&o.offset<f.offset+f.dims.W-0.5))continue;
      const lo=o.kind==='window'?(o.sill||0):0,hi=lo+o.height;if(el<hi-0.5&&lo<el+h-0.5){out.push('opening');break;}}
    /* настенный предмет не должен оказаться внутри напольного: телевизор «за шкафом» */
    if(f.typeId!=='curtain'){const me=aiPts(f,ctx);for(const g of placed){if(g.id===f.id||aiKind(g)!=='floor'||(g.dims.H||0)<=el+0.5)continue;if(aiHits(me,aiPts(g,ctx))){out.push('collision');break;}}}
    return out;
  }
  if(kind!=='floor')return out;
  const me=aiPts(f,ctx);if(!me.pts)return out;
  if(zones.door.some(z=>aiHits(me,z)))out.push('door');
  else if(zones.pass.some(z=>aiHits(me,z)))out.push('passage');
  if(zones.win.some(z=>h>z.sill+0.5&&aiHits(me,z)))out.push('window');
  for(const g of placed){if(g.id===f.id||aiKind(g)!=='wall'||g.typeId==='curtain'||(g.elev??0)>=h-0.5)continue;if(aiHits(me,aiPts(g,ctx))){out.push('collision');break;}}
  return out;
}
/* Можно ли поставить предмет f среди placed. → null или код причины. allow — нарушения, с которыми предмет уже стоял у пользователя.
   Правила те же, что в validateFurniture (границы комнаты и стены, основание, пересечения по слоям), но проверяется только f
   и только против соседей, чей габарит рядом: положений перебирается тысячи. Готовый вариант целиком ещё раз проверяет
   сама validateFurniture — см. aiBuildVariant. */
function aiFits(f,placed,ctx,allow){
  const t=TYPE.get(f.typeId),mt=aiMount(f),me=aiPts(f,ctx);if(!me.pts)return 'no_room';
  if(mt==='wall'){const i=ctx.d.W.get(f.wallId);if(f.offset<-0.5||f.offset+f.dims.W>i.len+0.5)return 'no_room';}
  else if(mt==='ontop'){const b=placed.find(x=>x.id===f.baseId);if(!b)return 'base';const bb=aiPts(b,ctx).bb,aa=me.bb;if(!bb||aa.x0<bb.x0-1||aa.x1>bb.x1+1||aa.y0<bb.y0-1||aa.y1>bb.y1+1)return 'base';}
  else if(!insideRoom(me.pts,ctx.Q,ctx.d))return 'outside';
  for(const g of placed){if(g.id===f.id)continue;const tg=TYPE.get(g.typeId),mg=aiMount(g);
    const check=(mt==='floor'&&mg==='floor'&&t.layer==='floor'&&tg.layer==='floor')||(mt==='ontop'&&mg==='ontop'&&f.baseId===g.baseId)||(mt==='wall'&&mg==='wall'&&f.wallId===g.wallId)||(mt==='ceiling'&&mg==='ceiling');
    if(check&&aiHits(me,aiPts(g,ctx)))return 'collision';}
  const iss=aiIssues(f,placed,ctx);
  for(const c of iss)if(!(allow&&allow.includes(c)))return c;
  return null;
}

/* ---------- способ постановки → положение ---------- */
/* Нынешнее положение предмета на языке модели (поле at запроса) */
function aiDescribe(f,ctx){
  if(aiKind(f)==='wall')return {mode:'mount',wall:ctx.wallAlias.get(f.wallId),offset:Math.round(f.offset),elev:Math.max(0,Math.round(f.elev??0))};
  const b=aiBackWall(f,ctx.d,ctx.Q);
  if(b)return Object.assign({mode:'wall',wall:ctx.wallAlias.get(b.wallId),offset:Math.round(b.offset)},b.gap>=1?{gap:Math.round(b.gap)}:{});
  return {mode:'free',x:Math.round(f.x-ctx.ox),y:Math.round(f.y-ctx.oy),face:aiFaceOf(f.rot)};
}
/* Модель вернула нынешнее место без изменений? */
function aiSameSpec(sp,at){
  if(!sp||!at||sp.mode!==at.mode||sp.ref)return false;
  if(at.mode==='free')return Math.abs(sp.x-at.x)<=1&&Math.abs(sp.y-at.y)<=1&&(sp.face===at.face||sp.face==='auto');
  if(sp.wall!==at.wall||Math.abs(sp.offset-at.offset)>1)return false;
  return at.mode==='mount'?(sp.elev<0||Math.abs(sp.elev-at.elev)<=1):Math.abs((sp.gap||0)-(at.gap||0))<=1;
}
/* → положение {x,y,rot} / {wallId,offset,elev} либо {err, wait}: wait — предмет, на который ссылаются, ещё не поставлен */
function aiResolve(sp,f,ctx){
  const {Q,d}=ctx;const kind=aiKind(f),e=aiExt(f);
  const refItem=(a)=>(a&&a!=='room')?ctx.byAlias.get(a)||null:null;
  const ref=(a)=>{const it=refItem(a);if(!it)return {err:'bad_ref'};if(!ctx.ready.has(it.id))return {err:'bad_ref',wait:it.id};const R=aiFrame(it,d);return R?{it,R}:{err:'bad_ref'};};
  const hasRef=!!(sp.ref&&sp.ref!=='room');
  if(kind==='wall'){
    const W=f.dims.W,H=f.dims.H||0;let wallId=null,offset=0,elev=sp.elev>=0?sp.elev:null;
    if(hasRef){const r=ref(sp.ref);if(r.err)return r;const {it,R}=r;const {ay}=aiAxes(R.rot);
      if(aiKind(it)==='wall'&&sp.side!=='front'){wallId=it.wallId;offset=it.offset+it.dims.W/2-W/2+(sp.shift||0);}
      else{const dir=sp.side==='front'?ay:{x:-ay.x,y:-ay.y};const hit=rayToWall({x:R.x,y:R.y},dir,Q,d);if(!hit)return {err:'no_room'};const i=d.W.get(hit.wallId);wallId=hit.wallId;
        offset=dot(sub(hit.pt,i.ref),{x:i.rx,y:i.ry})-W/2+(sp.shift||0);
        if(elev==null&&sp.side!=='front'&&aiKind(it)==='floor')elev=Math.max(aiDefElev(f),(it.dims.H||0)+150);}
    }else{wallId=ctx.wallId.get(sp.wall)||null;offset=sp.offset||0;}
    const i=wallId&&d.W.get(wallId);if(!i||i.len<W-0.5)return {err:'no_room'};
    if(elev==null)elev=aiDefElev(f);
    return {wallId,offset:Math.round(Math.max(0,Math.min(i.len-W,offset))),elev:Math.round(Math.max(0,Math.min(Math.max(0,Q.wallHeight-H),elev)))};
  }
  if(sp.mode==='wall'||sp.mode==='mount'){
    const i=d.W.get(ctx.wallId.get(sp.wall));if(!i||i.len<e.w-0.5)return {err:'no_room'};
    let off=sp.offset||0;
    if(hasRef){const r=ref(sp.ref);if(r.err)return r;off=dot(sub(r.R,i.ref),{x:i.rx,y:i.ry})-e.w/2+(sp.shift||0);}
    return aiWallFrame(i,e,Math.round(Math.max(0,Math.min(i.len-e.w,off))),Math.max(0,sp.gap||0));
  }
  if(sp.mode==='beside'){
    const r=ref(sp.ref);if(r.err)return r;const {it,R}=r;const {ax,ay}=aiAxes(R.rot);
    const side=sp.side==='none'?'front':sp.side,fb=side==='front'||side==='back';
    const dir=side==='front'?ay:side==='back'?{x:-ay.x,y:-ay.y}:side==='left'?{x:-ax.x,y:-ax.y}:ax;
    const along=fb?ax:ay,refHalf=fb?R.d/2:R.w/2;
    let face=sp.face;if(face==='auto')face=side==='front'?'toward':side==='back'?'same':(AI_SEATS.includes(f.typeId)&&AI_TABLES.includes(it.typeId))?'toward':'same';
    const rot=face==='toward'?aiRotFacing({x:-dir.x,y:-dir.y}):face==='away'?aiRotFacing(dir):face==='same'?aiNorm(R.rot):AI_FACE[face];
    const A=aiAxes(rot);const half=Math.abs(dot(dir,A.ax))*e.w/2+Math.abs(dot(dir,A.ay))*e.d/2;
    let sh=sp.shift||0;if(!fb&&face==='same')sh+=e.d/2-R.d/2; // сбоку и в ту же сторону лицом: тылы на одной линии (тумба у кровати)
    const k=refHalf+Math.max(0,sp.gap||0)+half;
    return {x:aiR2(R.x+dir.x*k+along.x*sh),y:aiR2(R.y+dir.y*k+along.y*sh),rot};
  }
  if(sp.mode==='center'){
    let c=ctx.centre,rot=f.rot,front=null;
    if(hasRef){const r=ref(sp.ref);if(r.err)return r;c={x:r.R.x,y:r.R.y};rot=r.R.rot;front=aiAxes(r.R.rot).ay;}
    if(AI_FACE[sp.face]!=null)rot=AI_FACE[sp.face];
    return {x:Math.round(c.x),y:Math.round(c.y),rot:aiNorm(rot),_front:front};
  }
  return {x:Math.round((sp.x||0)+ctx.ox),y:Math.round((sp.y||0)+ctx.oy),rot:AI_FACE[sp.face]!=null?AI_FACE[sp.face]:aiNorm(f.rot)};
}
/* Близкие положения на случай, когда задуманное не проходит проверку: от ближних к дальним */
function aiNudges(sp,f,fr,ctx){
  const out=[],d=ctx.d,e=aiExt(f),STEP=50;
  if(fr.wallId){const i=d.W.get(fr.wallId),max=i.len-f.dims.W;for(let k=1;k*STEP<=i.len;k++)for(const s of [1,-1]){const o=fr.offset+s*k*STEP;if(o>=0&&o<=max)out.push({wallId:fr.wallId,offset:Math.round(o),elev:fr.elev});}
    for(const o of [0,max])if(o>=0)out.push({wallId:fr.wallId,offset:Math.round(o),elev:fr.elev});return out;}
  if(fr._wall){const i=d.W.get(fr._wall),max=i.len-e.w;for(let k=1;k*STEP<=i.len;k++)for(const s of [1,-1]){const o=fr._off+s*k*STEP;if(o>=0&&o<=max)out.push(aiWallFrame(i,e,o,fr._gap));}
    for(const o of [0,max])if(o>=0)out.push(aiWallFrame(i,e,o,fr._gap));return out;}
  if(sp&&sp.mode==='beside'){
    const tryS=(patch)=>{const r=aiResolve(Object.assign({},sp,patch),f,ctx);if(!r.err)out.push(r);};
    const g0=Math.max(0,sp.gap||0),s0=sp.shift||0,opp={left:'right',right:'left',front:'back',back:'front'}[sp.side==='none'?'front':sp.side];
    for(const g of [50,100,150,200,300,450,600])tryS({gap:g0+g});
    for(let k=1;k<=24;k++)for(const s of [1,-1])tryS({shift:s0+s*k*STEP});
    for(const g of [50,150,300])for(let k=2;k<=16;k+=2)for(const s of [1,-1])tryS({gap:g0+g,shift:s0+s*k*STEP});
    if(sp.side==='left'||sp.side==='right'){tryS({side:opp});for(let k=1;k<=12;k++)for(const s of [1,-1])tryS({side:opp,shift:s0+s*k*STEP});}
    return out;
  }
  /* ковёр или люстра «по центру предмета»: сначала сдвиг вперёд от предмета (ковёр перед диваном), потом вокруг */
  if(fr._front)for(let k=1;k<=30;k++)out.push({x:Math.round(fr.x+fr._front.x*k*STEP),y:Math.round(fr.y+fr._front.y*k*STEP),rot:fr.rot});
  for(let r=100;r<=1200;r+=100)for(let a=0;a<8;a++){const an=a*Math.PI/4;out.push({x:Math.round(fr.x+Math.cos(an)*r),y:Math.round(fr.y+Math.sin(an)*r),rot:fr.rot});}
  return out;
}
/* Поставить f в первое подходящее из положений frames. → положение или null (в last — причина отказа первого) */
function aiFirstFit(f,frames,placed,ctx,allow,last){
  const keep=aiFrameOfItem(f);let first=true;
  for(const fr of frames){aiApplyFrame(f,fr,ctx.d);const code=aiFits(f,placed,ctx,allow);if(!code)return fr;if(first&&last){last.code=code;first=false;}}
  aiApplyFrame(f,keep,ctx.d);return null;
}

/* ---------- место подбирает программа ---------- */
/* Все разумные положения предмета в комнате, от ближних к желаемой точке want к дальним; первое, что проходит проверку, и берётся.
   Положение, которое мешает только окну, принимается, лишь если чистых не нашлось. */
function aiFallback(f,placed,ctx,want){
  const {d,Q,bb}=ctx;const kind=aiKind(f),e=aiExt(f);const w0=want||ctx.centre;const cand=[];
  const dist=(p)=>Math.hypot(p.x-w0.x,p.y-w0.y);
  if(kind==='wall'){
    const el=Math.round(Math.max(0,Math.min(Math.max(0,Q.wallHeight-(f.dims.H||0)),aiDefElev(f))));
    for(const i of ctx.walls){const max=i.len-f.dims.W;if(max<-0.5)continue;const offs=[];for(let o=0;o<=max;o+=100)offs.push(o);offs.push(Math.max(0,max));
      for(const o of offs){const along=o+f.dims.W/2;cand.push({fr:{wallId:i.w.id,offset:Math.round(o),elev:el},k:dist({x:i.ref.x+i.rx*along,y:i.ref.y+i.ry*along})});}}
  }else{
    const central=kind!=='floor'||AI_CENTRAL.includes(f.typeId);
    if(kind==='floor')for(const i of ctx.walls){const max=i.len-e.w;if(max<-0.5)continue;const offs=[];for(let o=0;o<=max;o+=100)offs.push(o);offs.push(Math.max(0,max));
      for(const o of offs){const fr=aiWallFrame(i,e,Math.round(o),0);cand.push({fr,k:dist(fr)-(central?0:1e6)});}}
    const rots=[...new Set([aiNorm(f.rot),0,90,180,270])];
    for(let x=bb.x0+100;x<bb.x1;x+=200)for(let y=bb.y0+100;y<bb.y1;y+=200){if(!pointInPoly({x,y},ctx.poly))continue;for(const rot of (kind==='floor'?rots:rots.slice(0,2)))cand.push({fr:{x:Math.round(x),y:Math.round(y),rot},k:dist({x,y})+(rot===rots[0]?0:1)});}
  }
  cand.sort((a,b)=>a.k-b.k);
  const keep=aiFrameOfItem(f);let soft=null;
  for(const c of cand){aiApplyFrame(f,c.fr,d);const code=aiFits(f,placed,ctx);if(!code)return c.fr;if(code==='window'&&!soft&&!aiFits(f,placed,ctx,['window']))soft=c.fr;}
  if(soft){aiApplyFrame(f,soft,d);return soft;}
  aiApplyFrame(f,keep,d);return null;
}

/* ---------- замена товара без перемещения ---------- */
/* Сдвиги нового предмета относительно прежнего места вдоль ширины: по центру, по одному краю, по другому,
   затем промежуточные от центра к краям — пока новый предмет перекрывает прежнее место (или лежит внутри него). */
function aiAnchorShifts(dw,flush){
  /* прежний предмет стоял вплотную к углу — новый остаётся в том же углу; иначе сначала по центру прежнего места */
  const out=flush==='start'?[0,dw/2,dw]:flush==='end'?[dw,dw/2,0]:[dw/2,0,dw],lo=Math.min(0,dw),hi=Math.max(0,dw);
  for(let k=1;k*50<(hi-lo)/2;k++)out.push(dw/2+k*50,dw/2-k*50);
  return out;
}
const aiFlush=(off,w,len)=>{const a=off<=5,b=off+w>=len-5;return a&&!b?'start':b&&!a?'end':null;};
/* Где встанет предмет f (уже с новыми размерами), если прежний f0 двигать нельзя. Предмет у стены остаётся у стены. */
function aiAnchors(f0,f,ctx){
  const d=ctx.d;
  if(aiMount(f)==='wall'){const i=d.W.get(f0.wallId);if(!i)return [];const max=i.len-f.dims.W;if(max<-0.5)return [];const el=f.elev??f0.elev??0;
    const cl=(o)=>Math.round(Math.max(0,Math.min(max,o)));return aiAnchorShifts(f0.dims.W-f.dims.W,aiFlush(f0.offset,f0.dims.W,i.len)).map(s=>({wallId:f0.wallId,offset:cl(f0.offset+s),elev:Math.round(Math.max(0,Math.min(Math.max(0,ctx.Q.wallHeight-(f.dims.H||0)),el)))}));}
  const e0=aiExt(f0),e=aiExt(f),b=aiBackWall(f0,d,ctx.Q);
  if(b){const i=b.info,max=i.len-e.w;if(max<-0.5)return [];return aiAnchorShifts(e0.w-e.w,aiFlush(b.offset,e0.w,i.len)).map(s=>aiWallFrame(i,e,Math.round(Math.max(0,Math.min(max,b.offset+s))),Math.round(b.gap)));}
  const {ax}=aiAxes(f0.rot);const dw=e0.w-e.w;
  return aiAnchorShifts(dw).map(s=>{const k=s-dw/2;return {x:Math.round(f0.x+ax.x*k),y:Math.round(f0.y+ax.y*k),rot:f0.rot};});
}
/* Размеры формы, при которых габарит в плане равен w×d */
function aiDimsFor(fo,dims,w,d){
  const o=Object.assign({},dims);
  switch(fo.fp){case 'square':o.W=w;break;case 'circle':o.DIA=w;break;case 'quarter':o.R=w;break;case 'L':case 'U':o.A=w;o.B=d;break;
    default:o[fo.dims[0]]=w;if(fo.dims[1])o[fo.dims[1]]=d;}
  return o;
}
/* Наибольший габарит товара, который встанет на место неподвижного предмета f0 среди неподвижных соседей fixed.
   По этому пределу сервер отбирает кандидатов — чтобы не предлагать то, что заведомо не поместится. */
function aiMaxFit(f0,fixed,ctx){
  const t=TYPE.get(f0.typeId),fo=formOf(t,f0.formId),e0=aiExt(f0),one=['square','circle','quarter'].includes(fo.fp);
  const others=fixed.filter(x=>x.id!==f0.id);const allow=aiIssues(f0,others,ctx);
  /* пробуются три основные привязки (по центру и по краям): оценка чуть осторожнее настоящей, зато считается быстро */
  const probe=(w,dd)=>{const f=Object.assign({},f0,{productId:null,dims:aiDimsFor(fo,f0.dims,w,one?w:dd)});return !!aiFirstFit(f,aiAnchors(f0,f,ctx).slice(0,3),others,ctx,allow);};
  const HI=Math.min(DIMLIM.max,Math.max(ctx.bb.w,ctx.bb.h));
  const grow=(fn,from)=>{if(!fn(from))return from;let lo=from,hi=HI;if(fn(hi))return hi;for(let k=0;k<12&&hi-lo>10;k++){const m=(lo+hi)/2;if(fn(m))lo=m;else hi=m;}return Math.floor(lo);};
  const w=grow((x)=>probe(x,e0.d),e0.w);
  const dd=one?w:grow((x)=>probe(e0.w,x),e0.d);
  return {w:Math.round(w),d:Math.round(dd)};
}

/* ---------- предметы на основании ---------- */
/* Лампа стоит на тумбе: тумбу двигают или меняют — лампа едет вместе с ней и остаётся на прежнем месте столешницы */
function aiFollowBase(f,f0,base0,base1,ctx){
  const d=ctx.d,R0=aiFrame(base0,d),R1=aiFrame(base1,d);if(!R0||!R1)return false;
  const A0=aiAxes(R0.rot),A1=aiAxes(R1.rot);const v={x:f0.x-R0.x,y:f0.y-R0.y};const lx=dot(v,A0.ax),ly=dot(v,A0.ay);
  f.x=R1.x+A1.ax.x*lx+A1.ay.x*ly;f.y=R1.y+A1.ax.y*lx+A1.ay.y*ly;f.rot=aiNorm(f0.rot+R1.rot-R0.rot);
  const bb=aabbOf(fWorldOf(base1,ctx.Q,d)),aa=aabbOf(fWorld(f));
  if(aa.w>bb.w+1||aa.h>bb.h+1)return false;
  f.x=Math.round(Math.max(bb.x0+aa.w/2,Math.min(bb.x1-aa.w/2,f.x)));f.y=Math.round(Math.max(bb.y0+aa.h/2,Math.min(bb.y1-aa.h/2,f.y)));
  return true;
}

/* ---------- расстановка варианта ---------- */
/* V = {items, info: Map(id → {f0, movable, kind}), specs: Map(id → способ постановки), at: Map(id → нынешнее место на языке модели)}
   → {placed, failed:[{id,code}], auto:[id], soft:[id]}; auto — место подобрала программа, soft — принято с замечанием.
   opts.fallback — подбирать место программой для тех, кого не удалось поставить по ответу модели. */
function aiPlace(V,ctx,opts={}){
  const d=ctx.d;const placed=[],failed=[],auto=[];ctx.ready=new Set();
  const fail=(id,code)=>{if(!failed.some(x=>x.id===id))failed.push({id,code});};
  const done=(f)=>{placed.push(f);ctx.ready.add(f.id);};
  const flat=V.items.filter(f=>V.info.get(f.id).kind!=='ontop');
  /* 1. неподвижные: сначала те, что стоят как стояли; затем те, у кого сменился товар, — на прежней привязке */
  const still=flat.filter(f=>!V.info.get(f.id).movable);
  for(const f of still){const inf=V.info.get(f.id);if(inf.changed)continue;aiApplyFrame(f,aiFrameOfItem(inf.f0),d);done(f);}
  for(const f of still){const inf=V.info.get(f.id);if(!inf.changed)continue;
    const allow=aiIssues(inf.f0,placed,ctx);
    if(aiFirstFit(f,aiAnchors(inf.f0,f,ctx),placed,ctx,allow))done(f);else fail(f.id,'no_room');
  }
  /* 2. подвижные: по ответу модели; ссылка на ещё не поставленный предмет откладывает постановку */
  const order={floor:0,rug:1,wall:2,ceiling:3};
  let pending=flat.filter(f=>V.info.get(f.id).movable).sort((a,b)=>order[V.info.get(a.id).kind]-order[V.info.get(b.id).kind]||(aiExt(b).w*aiExt(b).d-aiExt(a).w*aiExt(a).d));
  const want=new Map();
  const tryOne=(f,ignoreRef)=>{
    const inf=V.info.get(f.id),at=V.at.get(f.id);let sp=V.specs.get(f.id)||at;
    if(ignoreRef&&sp.ref&&sp.ref!=='room')sp=at;
    let frames,allow=null;
    /* «оставить на месте»: как при замене без перемещения; замечания, с которыми предмет стоял у пользователя, не мешают */
    if(aiSameSpec(sp,at)){frames=aiAnchors(inf.f0,f,ctx);allow=aiIssues(inf.f0,placed,ctx);}
    else{const r=aiResolve(sp,f,ctx);if(r.err){if(r.wait&&!ignoreRef)return {wait:r.wait};return {code:r.err};}frames=[r];}
    if(!frames.length)return {code:'no_room'};
    const f1=frames[0];
    if(f1.wallId){const i=d.W.get(f1.wallId),al=f1.offset+f.dims.W/2;want.set(f.id,{x:i.ref.x+i.rx*al,y:i.ref.y+i.ry*al});}else want.set(f.id,{x:f1.x,y:f1.y});
    const last={};
    if(aiFirstFit(f,frames,placed,ctx,allow,last))return {ok:true};
    if(aiFirstFit(f,aiNudges(sp,f,frames[0],ctx),placed,ctx))return {ok:true};
    return {code:last.code||'collision'};
  };
  const round=(ignoreRef)=>{let moved=true;while(moved&&pending.length){moved=false;const rest=[];
    for(const f of pending){const r=tryOne(f,ignoreRef);if(r.ok){done(f);moved=true;}else if(r.wait)rest.push(f);else{fail(f.id,r.code);moved=true;}}
    pending=rest;}};
  round(false);
  const waiting=pending.map(f=>f.id);
  if(opts.fallback){
    /* 3. кого не удалось поставить — ищем место программой, начиная от задуманной точки или прежнего места */
    const tried=new Set();
    const fb=(f)=>{const inf=V.info.get(f.id);
      /* сначала — оставить, где стоял у заказчика (с теми замечаниями, с которыми он его поставил), потом — искать по комнате */
      if(aiFirstFit(f,aiAnchors(inf.f0,f,ctx),placed,ctx,aiIssues(inf.f0,placed,ctx))){done(f);auto.push(f.id);return true;}
      const w=want.get(f.id)||{x:inf.f0.x,y:inf.f0.y};const fr=aiFallback(f,placed,ctx,w);if(fr){done(f);auto.push(f.id);return true;}return false;};
    const sweep=()=>{for(const x of failed.slice()){const f=V.items.find(i=>i.id===x.id);if(!f||!V.info.get(f.id).movable||tried.has(f.id))continue;tried.add(f.id);if(fb(f))failed.splice(failed.indexOf(x),1);}};
    sweep();
    round(false);sweep();   // те, кто ждал поставленных только что
    round(true);sweep();    // ссылка так и не разрешилась (кольцо или несуществующий предмет) — ставим без неё
    for(const f of pending){if(!fb(f))fail(f.id,'collision');}
    pending=[];
  }
  /* 4. предметы на основаниях едут за своими основаниями */
  for(const f of V.items){const inf=V.info.get(f.id);if(inf.kind!=='ontop')continue;const b0=V.info.get(f.baseId);const b1=V.items.find(x=>x.id===f.baseId);
    if(!b0||!b1||!ctx.ready.has(b1.id)){fail(f.id,'base');continue;}
    if(!aiFollowBase(f,inf.f0,b0.f0,b1,ctx)){fail(f.id,'base');continue;}
    const code=aiFits(f,placed,ctx);if(code){fail(f.id,code==='collision'?'collision':'base');continue;}
    done(f);
  }
  return {placed,failed,waiting:opts.fallback?[]:waiting,auto};
}
