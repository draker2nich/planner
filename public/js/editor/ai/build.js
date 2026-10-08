'use strict';
/* furnitech · редактор · ai/build.js
   ИИ‑дизайнер: права, проверка перед запуском, запросы к серверу и сборка варианта из ответов модели.
   Без обращения к странице; к сети обращается только переданная снаружи функция job.layout.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html.

   Права соблюдаются устройством кода, а не просьбой к модели:
     «Ничего»            предмет копируется как есть;
     «Двигать»           модель называет только место, товар остаётся;
     «Заменить»          модель выбирает товар, место сохраняет программа (aiAnchors);
     «Двигать и заменять» и то и другое.
   Предмет на основании (лампа на тумбе) и угловой предмет‑четверть ИИ не передвигает. */

const AI_LIMITS={items:60,walls:40,openings:60,wallOpenings:20};
const AI_WHY={collision:'не нашлось свободного места',outside:'не помещается в комнате',door:'мешает двери',passage:'перекрывает проход',window:'загораживает окно',
  opening:'перекрывает проём на стене',no_room:'не помещается на своём месте',bad_ref:'не нашлось места',height:'не помещается по высоте',base:'не помещается на основании'};

/* ---------- права ---------- */
/* Действующее право ИИ на предмет: выбранное в мастере с поправкой на то, что с этим предметом вообще возможно */
function aiPolicy(f,p){
  p=p||'free';const t=TYPE.get(f.typeId),fo=formOf(t,f.formId);
  if(!f.productId){if(p==='keep')p='replace';if(p==='move')p='free';}
  if(mountOf(t,fo)==='ontop'||AI_FIXED_FP.includes(fo.fp)){if(p==='move')p='keep';if(p==='free')p='replace';}
  if(!f.productId&&p==='keep')p='replace';
  return p;
}
/* Какие права можно выбрать в мастере: {право: null | причина, по которой оно недоступно} */
function aiPolicyOptions(f){
  const t=TYPE.get(f.typeId),fo=formOf(t,f.formId),ph=!f.productId;
  const stuck=mountOf(t,fo)==='ontop'?'Стоит на другом предмете и перемещается вместе с ним':AI_FIXED_FP.includes(fo.fp)?'Угловой предмет ИИ не передвигает':null;
  return {keep:ph?'Пустышка: ИИ обязан подобрать товар':null,move:ph?'Пустышке нужен товар: выберите «Заменить» или «Двигать и заменять»':stuck,replace:null,free:stuck};
}
/* Есть ли работа для ИИ‑дизайнера: хоть один предмет можно менять или разрешено менять отделку */
function aiNeeds(policies,room){return (P.furniture||[]).some(f=>aiPolicy(f,policies.get(f.id))!=='keep')||['walls','floor','ceiling'].some(k=>room&&room[k]==='ai');}

/* ---------- комната и места ---------- */
function aiRoomNumbers(ctx){
  const p=ctx.Q;return {wallHeight:p.wallHeight,longestWall:Math.round(Math.max(...ctx.walls.map(i=>i.len))),maxSpan:Math.round(Math.max(ctx.bb.w,ctx.bb.h)),
    area:Math.max(0.1,Math.round(Math.abs(ctx.d.area)/1e4)/100),w:Math.round(ctx.bb.w),h:Math.round(ctx.bb.h),doors:p.openings.filter(o=>o.kind!=='window').length,windows:p.openings.filter(o=>o.kind==='window').length};
}
function aiRoomData(ctx){
  const {ox,oy,Q}=ctx;const r2=(v)=>Math.round(v*100)/100;
  return {wallHeight:Math.round(Q.wallHeight),walls:ctx.walls.map(i=>({id:ctx.wallAlias.get(i.w.id),from:[Math.round(i.ref.x-ox),Math.round(i.ref.y-oy)],to:[Math.round(i.oth.x-ox),Math.round(i.oth.y-oy)],inward:[r2(-i.nx),r2(-i.ny)],
    openings:wallOpenings(i.w.id,Q).slice(0,20).map(o=>Object.assign({kind:o.kind,from:Math.round(o.offset),to:Math.round(o.offset+o.width)},o.kind==='window'?{sill:Math.round(o.sill||0),top:Math.round((o.sill||0)+o.height)}:{},o.kind==='door'?{swing:o.swing==='in'?'in':'out'}:{}))}))};
}
/* ограничения размеров в том виде и в тех пределах, которые принимает сервер */
function aiCleanCons(c){const lim=(v)=>Math.max(0,Math.min(20000,v)),num=(v)=>typeof v==='number'&&isFinite(v);const out={};
  for(const k in (c||{})){const v=c[k];if(!v||!DIMN[k])continue;
    if(v.mode==='exact'&&num(v.exact)&&v.exact>=1)out[k]={mode:'exact',exact:lim(v.exact)};
    else if(v.mode==='range'&&(num(v.min)||num(v.max)))out[k]=Object.assign({mode:'range'},num(v.min)?{min:lim(v.min)}:{},num(v.max)?{max:lim(v.max)}:{});}
  return out;}
function aiCleanDims(dm){const out={};for(const k in (dm||{}))if((DIMN[k]||k==='E')&&typeof dm[k]==='number'&&isFinite(dm[k])&&dm[k]>=0)out[k]=Math.min(20000,dm[k]);return out;}
/* Места, на которые нужно подобрать товар: предметы с правом «Заменить» или «Двигать и заменять».
   items — исходная расстановка, policy — Map(id → действующее право). → {slots, room} */
function aiSlots(items,policy,ctx){
  const room=aiRoomNumbers(ctx);const still=items.filter(f=>{const p=policy.get(f.id);return (p==='keep'||p==='replace')&&aiKind(f)!=='ontop';});
  const slots=[];
  for(const f of items){const p=policy.get(f.id);if(p!=='replace'&&p!=='free')continue;const kind=aiKind(f);let maxFit=null;
    if(kind==='ontop'){const b=items.find(x=>x.id===f.baseId);if(b){const bb=aabbOf(fWorldOf(b,ctx.Q,ctx.d));const r=aiNorm(f.rot)%180;maxFit=r<1||r>179?{w:Math.round(bb.w),d:Math.round(bb.h)}:Math.abs(r-90)<1?{w:Math.round(bb.h),d:Math.round(bb.w)}:{w:Math.round(Math.min(bb.w,bb.h)),d:Math.round(Math.min(bb.w,bb.h))};}}
    else if(p==='replace')maxFit=aiMaxFit(f,still,ctx);
    else if(kind!=='wall')maxFit={w:room.maxSpan,d:room.maxSpan};
    slots.push({id:f.id,typeId:f.typeId,formId:f.formId,formAny:!!f.formAny,productId:f.productId||null,policy:p,dims:aiCleanDims(f.dims),constraints:aiCleanCons(f.constraints),maxFit});}
  return {slots,room};
}
const aiCandidates=(slot,room)=>PRODUCTS.filter(pr=>slotAccepts(pr,slot,room)).length;

/* ---------- проверка перед запуском ---------- */
/* items — расстановка, от которой строятся варианты (по умолчанию то, что на плане).
   → {errors:[текст], slots, room, empty:[предметы без кандидатов], policy, ctx}. С ошибками генерация не запускается. */
function aiPrecheck(policies,room,items=P.furniture||[]){
  const errors=[];
  const ctx=aiCtx(P);
  if(!ctx)return {errors:['Контур комнаты не замкнут'],slots:[],empty:[]};
  if(CATALOG_SOURCE!=='server')errors.push('Каталог товаров не загрузился с сервера. Обновите страницу и попробуйте ещё раз');
  if(items.length>AI_LIMITS.items)errors.push(`ИИ‑дизайнер работает с планами до ${AI_LIMITS.items} предметов — сейчас их ${items.length}`);
  if(P.walls.length>AI_LIMITS.walls)errors.push(`ИИ‑дизайнер работает с комнатами до ${AI_LIMITS.walls} стен`);
  if(P.openings.length>AI_LIMITS.openings||P.walls.some(w=>P.openings.filter(o=>o.wallId===w.id).length>AI_LIMITS.wallOpenings))errors.push(`ИИ‑дизайнер работает с комнатами, где не больше ${AI_LIMITS.openings} проёмов и не больше ${AI_LIMITS.wallOpenings} на одной стене`);
  for(const f of items){if(!TYPE.get(f.typeId)){errors.push(`${f.name}: неизвестный тип предмета`);continue;}if(f.productId&&!PRODUCT_BY_ID.get(f.productId))errors.push(`${f.name}: товара больше нет в каталоге — замените его или сделайте пустышкой`);}
  if(!errors.length){const Q=Object.assign({},ctx.Q,{furniture:items,_strict:items.map(f=>f.id)});const e=validateFurniture(Q,ctx.d);if(e)errors.push('Сначала исправьте расстановку: '+e);}
  if(errors.length)return {errors,slots:[],empty:[]};
  const policy=new Map(items.map(f=>[f.id,aiPolicy(f,policies.get(f.id))]));
  const {slots,room:nums}=aiSlots(items,policy,ctx);
  const rm={wallHeight:nums.wallHeight,longestWall:nums.longestWall};
  const empty=slots.filter(s=>!aiCandidates(s,rm)).map(s=>items.find(f=>f.id===s.id));
  return {errors,slots:slots.filter(s=>!empty.some(f=>f.id===s.id)),room:nums,empty,policy,ctx};
}

/* ---------- отделка ---------- */
function aiFinishesOf(p){const walls={};p.walls.forEach(w=>{walls[w.id]=w.material||null;});return {walls,floor:(p.floor&&p.floor.material)||null,ceiling:(p.ceiling&&p.ceiling.material)||null};}
function aiMaterial(token){
  if(/^#[0-9a-f]{6}$/.test(token||''))return {type:'color',color:token};
  if(/^texture:/.test(token||'')&&TEXLIB.some(t=>t.id===token.slice(8)))return {type:'texture',textureId:token.slice(8),scale:100,rotation:0,offset:[0,0]};
  return null;
}
/* Отделка варианта: tokens — ответ модели ('keep' | '#rrggbb' | 'texture:id'), base — отделка, от которой строится вариант */
function aiFinishes(tokens,base){
  const out=JSON.parse(JSON.stringify(base));const w=aiMaterial(tokens&&tokens.walls),fl=aiMaterial(tokens&&tokens.floor),c=aiMaterial(tokens&&tokens.ceiling);
  if(w)for(const id in out.walls)out.walls[id]=JSON.parse(JSON.stringify(w));
  if(fl)out.floor=fl;
  if(c&&c.type==='color')out.ceiling=c;
  return out;
}

/* ---------- сборка варианта ---------- */
function aiApplyProduct(f,pr){f.productId=pr.id;f.name=pr.name;f.formId=pr.formId;f.formAny=false;const el=f.elev;f.dims=Object.assign({},pr.dims);if(el!=null)f.elev=el;else if(pr.dims.E!=null&&aiMount(f)==='wall')f.elev=pr.dims.E;return f;}
function aiDimsChanged(a,b){if(a.formId!==b.formId)return true;for(const k of new Set([...Object.keys(a.dims),...Object.keys(b.dims)]))if(k!=='E'&&Math.abs((a.dims[k]||0)-(b.dims[k]||0))>0.5)return true;return false;}
/* Запрос шага «расстановка». retry — {placed:Set(id), failed:[{id,code}]} для повторной попытки. */
function aiLayoutRequest(V,ctx,job,retry){
  const items=[],{ox,oy}=ctx;
  const keyOf=(f)=>f.productId||(f.typeId+JSON.stringify(f.dims));const cnt=new Map(),num=new Map();
  for(const f of V.items){const inf=V.info.get(f.id);if(inf.movable){const k=keyOf(f);cnt.set(k,(cnt.get(k)||0)+1);}}
  for(const f of V.items){const inf=V.info.get(f.id);if(inf.kind==='ontop')continue;
    const e=inf.kind==='wall'?{w:f.dims.W,d:f.dims.D}:aiExt(f);
    const it={id:ctx.alias.get(f.id),type:f.typeId,w:Math.max(1,Math.round(e.w)),d:Math.max(1,Math.round(e.d)),h:Math.round(f.dims.H||0),kind:inf.kind};
    if(!inf.movable||(retry&&retry.placed.has(f.id))){it.fixed=true;const pts=fWorldOf(f,ctx.Q,ctx.d);if(pts){const a=aabbOf(pts);it.box=[a.x0-ox,a.y0-oy,a.x1-ox,a.y1-oy].map(Math.round);}it.at=aiDescribe(f,ctx);}
    else{it.at=V.at.get(f.id);const pb=retry&&retry.failed.find(x=>x.id===f.id);if(pb&&pb.code!=='base')it.problem=pb.code;
      const k=keyOf(f);if(cnt.get(k)>1){if(!num.has(k))num.set(k,num.size+1);it.pair=num.get(k);}}
    items.push(it);}
  /* замысел возвращается серверу дословно вместе с его печатью (seal): так сервер знает, что текст написала модель на шаге «концепция» */
  const c=job.concept;
  return {pass:job.pass,variant:job.index,room:aiRoomData(ctx),items,concept:{title:c.title||'',note:c.note||'',layoutIdea:c.layoutIdea||'',wishes:c.wishes||'',seal:c.seal||''},
    text:job.text||'',comment:job.comment||'',mode:job.mode||'new',retry:!!retry};
}
/* Собрать один вариант.
   job = {index, mode, concept:{title,note,layoutIdea,wishes,seal,picks,finishes}, groups:[[slotId…]], start:[предметы, от которых строим],
          policy:Map(id→право), ctx, baseFinishes, pass, text, comment, empty:[id без кандидатов], signal: AbortSignal,
          layout: async (запрос) → {placements}}
   → клетка варианта {title, note, furniture, finishes, warnings, concept, stats} либо {failed:'причина', …} */
async function aiBuildVariant(job){
  const {ctx,concept}=job;const picks=concept.picks||{};
  const groupOf=new Map();(job.groups||[]).forEach((g,gi)=>g.forEach(id=>groupOf.set(id,gi)));
  const mates=(id)=>groupOf.has(id)?job.groups[groupOf.get(id)]:[id];
  const pick=new Map(),dropped=new Set();
  const choosable=(id)=>{const p=job.policy.get(id);return (p==='replace'||p==='free')&&Array.isArray(picks[id])&&picks[id].length>0&&!dropped.has(id);};
  const advance=(id)=>{if(!choosable(id))return false;const k=(pick.get(id)||0)+1;if(k>=picks[id].length)return false;mates(id).forEach(x=>pick.set(x,k));return true;};
  const drop=(id)=>{if(!choosable(id))return false;mates(id).forEach(x=>dropped.add(x));return true;};
  const aliasOf=new Map();job.start.filter(f=>aiKind(f)!=='ontop').forEach((f,k)=>aliasOf.set(f.id,'i'+(k+1)));
  const at=new Map();job.start.forEach(f=>{if(aiKind(f)!=='ontop')at.set(f.id,aiDescribe(f,ctx));});
  let specs=new Map();
  const make=()=>{
    const items=JSON.parse(JSON.stringify(job.start)),info=new Map();
    ctx.byAlias=new Map();ctx.alias=aliasOf;
    for(const f of items){const f0=job.start.find(x=>x.id===f.id),pol=job.policy.get(f.id)||'keep';
      if(choosable(f.id)){const pr=PRODUCT_BY_ID.get(picks[f.id][pick.get(f.id)||0]);if(pr)aiApplyProduct(f,pr);}
      const kind=aiKind(f);
      info.set(f.id,{f0,policy:pol,kind,movable:(pol==='move'||pol==='free')&&kind!=='ontop',changed:aiDimsChanged(f0,f)});
      if(aliasOf.has(f.id))ctx.byAlias.set(aliasOf.get(f.id),f);}
    return {items,info,specs,at};
  };
  /* Что делать с предметом, который не удалось поставить: следующий товар из трёх, затем отказ от замены */
  const fix=(V,x)=>{
    const f=V.items.find(i=>i.id===x.id),inf=V.info.get(x.id);
    if(inf.kind==='ontop'){const b=f.baseId;return advance(x.id)||(V.info.get(b)&&V.info.get(b).changed&&advance(b))||drop(x.id)||(V.info.get(b)&&V.info.get(b).changed&&drop(b))||false;}
    return advance(x.id)||drop(x.id);
  };
  const stats={calls:0,retried:false,rounds:0};
  let V,res;
  /* расчёт идёт в основном потоке страницы: между проходами уступаем очередь событий, чтобы работала «Отмена» */
  const tick=async()=>{await new Promise(r=>setTimeout(r,0));if(job.signal&&job.signal.aborted){const e=new Error('Отменено');e.name='AbortError';throw e;}};
  /* исправить за один проход всех, кого не удалось поставить; у группы одинаковых мест товар сдвигается один раз */
  const fixAll=(list)=>{const seen=new Set();let any=false;for(const x of list){const g=groupOf.has(x.id)?'g'+groupOf.get(x.id):x.id;if(seen.has(g))continue;if(fix(V,x)){any=true;seen.add(g);}}return any;};
  /* 1. неподвижные предметы с новым товаром встают на прежнюю привязку; не встали — следующий товар.
     Предмет на подвижном основании здесь не судится: основание ещё не расставлено. */
  const stuck=(x)=>{const inf=V.info.get(x.id);if(inf.movable)return false;if(inf.kind!=='ontop')return true;const b=V.info.get(V.items.find(i=>i.id===x.id).baseId);return !(b&&b.movable);};
  for(let k=0;k<40;k++){V=make();res=aiPlace(V,ctx,{});if(!fixAll(res.failed.filter(stuck)))break;await tick();}
  /* 2. расстановка подвижных: модель, одна повторная попытка, затем место подбирает программа */
  const movable=()=>V.items.some(f=>V.info.get(f.id).movable);
  if(movable()){const ans=await job.layout(aiLayoutRequest(V,ctx,job,null));stats.calls++;specs=aiSpecs(ans,aliasOf);}
  for(let k=0;k<40;k++){
    stats.rounds++;await tick();V=make();res=aiPlace(V,ctx,{});
    const open=res.failed.some(x=>V.info.get(x.id).movable)||res.waiting.length>0;
    if(open&&!stats.retried&&specs.size){
      stats.retried=true;
      try{const ans=await job.layout(aiLayoutRequest(V,ctx,job,{placed:new Set(res.placed.map(f=>f.id)),failed:res.failed}));stats.calls++;for(const [id,sp] of aiSpecs(ans,aliasOf))specs.set(id,sp);continue;}
      catch(e){stats.retryError=e&&e.code||'error';} // повторная попытка не удалась — доводим программой
    }
    await tick();V=make();res=aiPlace(V,ctx,{fallback:true});
    if(!res.failed.length)break;
    if(!fixAll(res.failed))break;
  }
  const cell={title:concept.title||'',note:concept.note||'',concept:{title:concept.title||'',note:concept.note||'',layoutIdea:concept.layoutIdea||'',picks,finishes:concept.finishes||{}},stats,createdAt:new Date().toISOString(),from:job.mode||'new'};
  if(res.failed.length){
    const names=res.failed.slice(0,3).map(x=>{const f=V.items.find(i=>i.id===x.id);return `${f?f.name:'предмет'} — ${AI_WHY[x.code]||'не удалось поставить'}`;});
    cell.failed='Не удалось расставить: '+names.join('; ')+(res.failed.length>3?` и ещё ${res.failed.length-3}`:'');
    return cell;
  }
  /* 3. итоговая проверка тем же правилом, что и ручная расстановка: всё, к чему прикасался ИИ, — строго */
  const Q=ctx.Q;Q.furniture=V.items;Q._strict=V.items.filter(f=>V.info.get(f.id).policy!=='keep').map(f=>f.id);
  const err=validateFurniture(Q,ctx.d);delete Q._strict;
  if(err){cell.failed='Расстановка не прошла проверку: '+err;return cell;}
  const warnings=[];
  for(const f of V.items){
    f.warnings=furnitureWarnings(f,Q,ctx.d);const inf=V.info.get(f.id);
    if(dropped.has(f.id))warnings.push({id:f.id,text:f.productId?`${f.name}: не удалось заменить — подходящие товары не помещаются`:`${f.name}: подходящие товары не помещаются — осталась пустышка`});
    else if((job.empty||[]).includes(f.id))warnings.push({id:f.id,text:f.productId?`${f.name}: в каталоге нет товара на замену`:`${f.name}: в каталоге нет подходящего товара — осталась пустышка`});
    if(inf.policy!=='keep'&&f.warnings.includes('window'))warnings.push({id:f.id,text:`${f.name}: стоит перед окном — другого места не нашлось`});
  }
  stats.auto=res.auto.length;stats.spare=[...pick.values()].filter(k=>k>0).length;stats.dropped=dropped.size;
  cell.furniture=V.items;cell.finishes=aiFinishes(concept.finishes,job.baseFinishes);cell.warnings=warnings;
  return cell;
}
/* Ответ шага «расстановка» → Map(id предмета → способ постановки) */
function aiSpecs(ans,aliasOf){const byAlias=new Map([...aliasOf].map(([id,a])=>[a,id]));const m=new Map();for(const p of (ans&&ans.placements)||[]){const id=byAlias.get(p.id);if(id)m.set(id,p);}return m;}

/* ---------- генерация целиком ---------- */
function aiHash(s){let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return (h>>>0).toString(36);}
const aiPrefs=(prefs)=>{const o={};for(const k of ['style','palette','budget'])if(prefs&&typeof prefs[k]==='string'&&prefs[k])o[k]=prefs[k];return o;};
const aiMeaningful=(s)=>{s=(s||'').trim();return s.length>=10&&((s.match(/\p{L}/gu)||[]).length>=3);};
/* Товары из ответа сервера, которых нет в загруженном каталоге (появились после открытия редактора) */
function aiMergeProducts(list){for(const pr of list||[]){if(!pr||!pr.id||PRODUCT_BY_ID.has(pr.id))continue;PRODUCTS.push(pr);PRODUCT_BY_ID.set(pr.id,pr);}}
/* Три шага генерации: вкус → концепция → два варианта. Страницу не трогает — этим же кодом пользуется стенд tools/ai-eval.
   env = {mode:'new'|'again'|'refine', brief, base:{furniture,finishes}, start:{furniture,finishes}, pre: результат aiPrecheck по base,
          prev: прежний P.ai или null, project: комната (vertices, walls, openings, wallHeight), comment, signal: AbortSignal,
          api: async (путь, тело) → ответ сервера, photos: async () → {photos:[…], missing}, onStep: (шаг) => void}
   → {cells:[клетка, клетка], taste:{key, profile}, runsLeft} */
async function aiPipeline(env){
  const {mode,brief,base,start,pre,prev,api}=env;const step=env.onStep||(()=>{});
  const text=(brief.text||'').trim().slice(0,600),comment=(env.comment||'').trim().slice(0,300);
  /* 1. вкус: фото и текст → профиль; если пожелания не менялись — берётся разобранный ранее */
  step('taste');
  const types=[...new Set(base.furniture.map(f=>f.typeId))].sort();
  const key=aiHash(JSON.stringify([(brief.photos||[]).map(p=>[p.photoId,p.likes,p.furnitureTypes,p.comment]),text,aiPrefs(brief.prefs),types]));
  /* разобранный вкус годится, только если он с печатью сервера (seal): без неё сервер профиль не примет */
  let taste=prev&&prev.taste&&prev.taste.key===key&&(!prev.taste.profile||prev.taste.seal)?prev.taste:null;
  if(!taste){
    const ph=env.photos?await env.photos():{photos:[],missing:0};
    const prefsSignal=['style','palette'].some(k=>brief.prefs&&brief.prefs[k]&&brief.prefs[k]!=='Неважно');
    if(!ph.photos.length&&(brief.photos||[]).length&&!aiMeaningful(text)&&!prefsSignal)throw new Error('Фото‑референсы не найдены ни на этом устройстве, ни в аккаунте. Загрузите их заново или опишите пожелания словами');
    if(ph.photos.length||aiMeaningful(text)){const r=await api('/ai/taste',{photos:ph.photos,text,prefs:aiPrefs(brief.prefs),types:types.slice(0,60)});taste={key,profile:r.profile,seal:r.seal||'',missing:ph.missing||0};}
    else taste={key,profile:null};
  }
  /* 2. концепция: товары на места и отделка для двух вариантов */
  step('concept');
  const inStart=new Set(start.furniture.map(f=>f.id));
  const slots=pre.slots.filter(s=>inStart.has(s.id)),slotIds=new Set(slots.map(s=>s.id));
  const avoid=[];if(mode==='again'&&prev)for(const v of [...(prev.variants||[]),...(prev.prevVariants||[])])for(const f of (v&&v.furniture)||[])if(f.productId&&slotIds.has(f.id)&&!avoid.includes(f.productId))avoid.push(f.productId);
  const prefer={};if(mode==='refine')for(const f of start.furniture)if(f.productId&&slotIds.has(f.id))prefer[f.id]=f.productId;
  const room=brief.room||{},flag=(k)=>room[k]==='ai'?'ai':'keep';
  const cr=await api('/ai/concept',{room:pre.room,slots,context:base.furniture.filter(f=>!slotIds.has(f.id)).slice(0,60).map(f=>({typeId:f.typeId,productId:f.productId||null})),
    finishes:{walls:flag('walls'),floor:flag('floor'),ceiling:flag('ceiling')},taste:taste.profile,tasteSeal:taste.seal||'',prefs:aiPrefs(brief.prefs),text,mode,avoid:avoid.slice(0,300),prefer,comment});
  aiMergeProducts(cr.products);
  /* 3. расстановка: оба варианта строятся одновременно; сбой одного не отменяет другой */
  step('layout');
  const policy=new Map(start.furniture.map(f=>[f.id,pre.policy.get(f.id)||'keep']));
  const cells=await Promise.all(cr.concepts.slice(0,2).map(async(c,i)=>{
    const job={index:i,mode,concept:c,groups:cr.groups||[],start:start.furniture,policy,ctx:aiCtx(env.project),baseFinishes:start.finishes,pass:cr.pass,text,
      comment,empty:pre.empty.map(f=>f.id),signal:env.signal,layout:(req)=>api('/ai/layout',req)};
    try{const cell=await aiBuildVariant(job);cell.id=uid();return cell;}
    catch(e){if(e&&e.name==='AbortError')throw e;return {id:uid(),title:c.title||`Вариант ${i+1}`,note:c.note||'',failed:(e&&e.message)||'Не удалось построить вариант',createdAt:new Date().toISOString(),from:mode};}
  }));
  step('check');
  if(cells.every(c=>c.failed))throw new Error(cells[0].failed);
  return {cells,taste,runsLeft:cr.runsLeft==null?null:cr.runsLeft};
}
