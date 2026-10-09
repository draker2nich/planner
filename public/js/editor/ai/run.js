'use strict';
/* furnitech · редактор · ai/run.js
   ИИ‑дизайнер: хранение вариантов в проекте, переключение между ними и запуск генерации.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html.

   P.ai = {v, roomKey, base, brief, taste, variants, prevVariants, active, chosen}
     base      — исходная расстановка: {furniture, finishes:{walls:{id стены: материал}, floor, ceiling}}; от неё строится «заново»;
     variants  — два варианта: та же клетка + title, note, warnings, concept; failed — текст причины, если вариант не построен;
     active    — какая клетка сейчас на плане: 'base' | 0 | 1. На плане всегда P.furniture и материалы стен и пола;
                 при переключении нынешнее состояние записывается в свою клетку, другая загружается на план;
     chosen    — что выбрал заказчик: null | 'base' | 0 | 1;
     brief     — пожелания и права, с которыми строились варианты; taste — разобранный моделью вкус (чтобы не разбирать фото заново).
   Каждая запись в P.ai сбрасывает историю отмены: «Отменить» не должно возвращать проект в состояние с другими вариантами. */

const aiClone=(v)=>JSON.parse(JSON.stringify(v));
function aiRoomKey(p){return JSON.stringify([p.vertices.map(v=>[v.id,Math.round(v.x),Math.round(v.y)]),p.walls.map(w=>[w.id,w.a,w.b]),p.openings.map(o=>[o.id,o.kind,o.wallId,Math.round(o.offset),Math.round(o.width),Math.round(o.height),Math.round(o.sill||0),o.swing||'',o.hinge||'']),Math.round(p.wallHeight)]);}
const aiHasVariants=(p=P)=>!!(p.ai&&Array.isArray(p.ai.variants)&&p.ai.variants.length);
function aiCellOf(ai,which){return which==='base'?ai.base:(ai.variants||[])[which]||null;}
const aiCellName=(ai,which)=>which==='base'?'Исходная расстановка':((ai.variants[which]&&ai.variants[which].title)||`Вариант ${which+1}`);

/* Изменение P.ai и всего, что с ним связано. Расстановка здесь не проверяется: клетки проверены при сборке. */
function aiCommit(fn){
  if(READONLY)return READONLY_MSG;
  const Q=aiClone(P);const r=fn(Q);if(typeof r==='string')return r;
  Q.updatedAt=new Date().toISOString();P=Q;D=derive(P);E.sel=null;
  hist=[];hi=-1;snapshot();save();
  if(typeof T3!=='undefined'&&T3.active)T3.dirty=true;
  render();return null;
}
/* То, что сейчас на плане, → в активную клетку */
function aiStoreActive(Q){const cell=aiCellOf(Q.ai,Q.ai.active);if(!cell||cell.failed)return;cell.furniture=aiClone(Q.furniture||[]);cell.finishes=aiFinishesOf(Q);}
/* Клетка → на план */
function aiLoadCell(Q,cell){
  Q.furniture=aiClone(cell.furniture||[]);const fin=cell.finishes||{walls:{}};
  Q.walls.forEach(w=>{const m=fin.walls&&fin.walls[w.id];if(m)w.material=aiClone(m);else delete w.material;});
  Q.floor=Object.assign({},Q.floor,{material:fin.floor?aiClone(fin.floor):{type:'color',color:FLOOR_DEF}});
  if(fin.ceiling)Q.ceiling={material:aiClone(fin.ceiling)};else delete Q.ceiling;
  refreshWarnings(Q);
}
/* Показать на плане другую клетку. status — заодно сменить состояние проекта ('draft' — план, 'submitted' — экран результата):
   одной записью, чтобы «Отменить» не могло вернуть проект в состояние с другим экраном. */
function aiSwitch(to,status){
  if(!aiHasVariants())return null;
  if(aiCheckStale())return 'Комната изменилась — варианты удалены';
  const cell=aiCellOf(P.ai,to);if(!cell||cell.failed)return 'Этот вариант не построен';
  if(P.ai.active===to&&(!status||P.status===status))return null;
  const sel3d=typeof T3!=='undefined'&&T3.active;
  if(sel3d){selectIn3D(null,true);closeMaterialPanel();} // панель материалов и выбор относились к прежней клетке
  /* просмотр чужого проекта поддержкой: клетка показывается, но ничего не записывается и не сохраняется */
  if(READONLY){if(P.ai.active!==to){aiLoadCell(P,cell);P.ai.active=to;D=derive(P);E.sel=null;if(sel3d)T3.dirty=true;render();}return null;}
  return aiCommit(Q=>{if(Q.ai.active!==to){aiStoreActive(Q);aiLoadCell(Q,aiCellOf(Q.ai,to));Q.ai.active=to;}if(status)Q.status=status;});
}
/* Правки, сделанные на плане, → в активную клетку. Вызывается перед всем, что читает клетки: экран результата, новая генерация. */
function aiSyncActive(){
  if(!aiHasVariants()||READONLY)return;
  const cell=aiCellOf(P.ai,P.ai.active);if(!cell||cell.failed)return;
  if(JSON.stringify(cell.furniture||[])===JSON.stringify(P.furniture||[])&&JSON.stringify(cell.finishes||null)===JSON.stringify(aiFinishesOf(P)))return;
  aiCommit(Q=>{aiStoreActive(Q);});
}
/* Убрать варианты; на плане остаётся то, что сейчас на экране */
function aiDrop(){return aiCommit(Q=>{Q.ai=null;if(Q.status==='submitted')Q.status='draft';});}
/* Комната изменилась — варианты, построенные для прежней, больше не годятся */
function aiCheckStale(){
  if(!P.ai||READONLY)return false;
  if(P.ai.roomKey===aiRoomKey(P))return false;
  aiDrop();toast('Комната изменилась — варианты ИИ‑дизайнера удалены, на плане осталась нынешняя расстановка',true);return true;
}
/* Переход к стенам при готовых вариантах: спросить и убрать варианты. → true, если переход взят на себя */
function aiGuardWalls(){
  if(!aiHasVariants()||READONLY)return false;
  confirmDlg('Изменить комнату?','Варианты ИИ‑дизайнера построены для нынешней комнаты. Если перейти к стенам и проёмам, варианты будут удалены; на плане останется то, что сейчас на экране.','Перейти к стенам',true)
    .then(ok=>{if(!ok)return;const err=aiDrop();if(err){toast(err,true);return;}showResult();setMode('walls');});
  return true;
}

/* ---------- настройки сервера ---------- */
let AI_CFG=null,AI_RUNS_LEFT=null;
async function aiConfig(){
  if(AI_CFG)return AI_CFG;
  try{const r=await fetch('/api/config',{headers:{Accept:'application/json'}});if(!r.ok)return {enabled:false,offline:true}; // сбой не запоминается: следующий раз спросим снова
    const j=await r.json();AI_CFG=Object.assign({enabled:false},j.ai||{});return AI_CFG;}
  catch(e){return {enabled:false,offline:true};}
}

/* ---------- фото‑референсы ---------- */
/* Фото уходят на сервер уменьшенными: модели хватает 1024 пикселей по длинной стороне, а запрос к функции ограничен 4,5 МБ */
async function aiPhotoData(blob,side,q){
  const bmp=await createImageBitmap(blob);const k=Math.min(1,side/Math.max(bmp.width,bmp.height));const w=Math.max(1,Math.round(bmp.width*k)),hh=Math.max(1,Math.round(bmp.height*k));
  const c=document.createElement('canvas');c.width=w;c.height=hh;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,w,hh);x.drawImage(bmp,0,0,w,hh);
  const url=c.toDataURL('image/jpeg',q);return url.slice(url.indexOf(',')+1);
}
async function aiPhotoPayload(photos){
  const recs=[];let missing=0;
  for(const p of photos||[]){let rec=null;try{rec=await photoRec(p.photoId);}catch(e){}if(rec&&rec.blob)recs.push({p,blob:rec.blob});else missing++;}
  const build=async(side,q)=>{const out=[];for(const r of recs)out.push({mime:'image/jpeg',data:await aiPhotoData(r.blob,side,q),likes:r.p.likes||[],furnitureTypes:r.p.furnitureTypes==='all'?'all':(r.p.furnitureTypes||[]).filter(t=>TYPE.has(t)).slice(0,20),comment:(r.p.comment||'').slice(0,300)});return out;};
  let out=await build(1024,0.82);
  if(out.reduce((s,p)=>s+p.data.length,0)>3300*1024)out=await build(768,0.72);
  return {photos:out,missing};
}

/* ---------- генерация ---------- */
/* opts: {mode:'new', brief} | {mode:'again'} | {mode:'refine', from: 0|1, comment}
   → true, если варианты построены и записаны в проект. */
let AI_BUSY=false;
async function aiStart(opts){
  if(READONLY){toast(READONLY_MSG);return false;}
  if(typeof needAccount==='function'&&needAccount('ИИ‑дизайнер работает в аккаунте.'))return false;
  if(AI_BUSY)return false;
  AI_BUSY=true;
  try{return await aiRun(opts);}finally{AI_BUSY=false;}
}
async function aiRun(opts){
  const mode=opts.mode;
  if(mode!=='new'&&(!aiHasVariants()||aiCheckStale()))return false;
  aiSyncActive();
  const prev=P.ai;
  const cfg=await aiConfig();
  if(!cfg.enabled){toast(cfg.offline?'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз':'ИИ‑дизайнер пока не подключён на сервере',true);return false;}
  const brief=mode==='new'?opts.brief:prev.brief;
  const base=mode==='new'?{furniture:aiClone(P.furniture||[]),finishes:aiFinishesOf(P)}:aiClone(prev.base);
  /* права записываются в предметы исходной расстановки — оттуда они переходят в варианты (значки прав на плане) */
  if(mode==='new')base.furniture.forEach(f=>{f.aiPolicy=(brief.policies||{})[f.id]||'free';});
  /* доработка строится от варианта в его нынешнем виде — с правками, которые заказчик внёс в него на плане */
  let start=base;
  if(mode==='refine'){const c=prev.active===opts.from?{furniture:aiClone(P.furniture||[]),finishes:aiFinishesOf(P)}:aiClone(prev.variants[opts.from]);if(!c||c.failed||!c.furniture){toast('Этот вариант не построен',true);return false;}start=c;}
  if(start.furniture.length>AI_LIMITS.items){toast(`ИИ‑дизайнер работает с планами до ${AI_LIMITS.items} предметов`,true);return false;}
  /* предмет, которого не было в брифе (заказчик добавил его в исходную расстановку позже), ИИ не трогает */
  const pre=aiPrecheck(new Map(base.furniture.map(f=>[f.id,(brief.policies||{})[f.id]||(mode==='new'?undefined:'keep')])),brief.room,base.furniture);
  if(pre.errors.length){toast(pre.errors[0],true);return false;}
  const stamp=P.id+'|'+P.updatedAt;
  const ctl=new AbortController();
  const api=(path,body)=>Session.api('POST',path,body,{signal:ctl.signal});
  const steps=[['taste','Разбираем пожелания и фото'],['concept','Подбираем мебель и отделку'],['layout','Расставляем мебель'],['check','Проверяем варианты']];
  const run=(setStep)=>aiPipeline({mode,brief,base,start,pre,prev,project:P,comment:opts.comment,api,signal:ctl.signal,photos:()=>aiPhotoPayload(brief.photos),onStep:setStep});
  const out=await dialog((box,api2)=>{
    box.classList.add('mid','aiprog');
    box.append(h('h3',{},mode==='refine'?'ИИ‑дизайнер дорабатывает вариант':'ИИ‑дизайнер работает'),h('div',{class:'hint'},'Обычно это занимает до минуты. Не закрывайте страницу.'));
    const list=h('ol',{class:'aisteps'});const rows=new Map();steps.forEach(([k,nm])=>{const li=h('li',{},h('i',{}),h('span',{},nm));rows.set(k,li);list.append(li);});box.append(list);
    const setStep=(k)=>{let seen=false;for(const [id,li] of rows){li.className=id===k?'now':seen?'':'done';if(id===k)seen=true;}};
    api2.buttons=[{label:'Отмена',cancel:true,onClick:()=>{ctl.abort();}}];
    run(setStep).then(r=>api2.close(r),e=>api2.close({error:e}));
  });
  if(!out||out.error||ctl.signal.aborted){
    const e=out&&out.error;
    if(ctl.signal.aborted||(e&&e.name==='AbortError')){toast('Генерация отменена');return false;}
    if(e&&e.code==='ai_off')AI_CFG=null;
    toast((e&&e.message)||'Не удалось построить варианты',true);return false;
  }
  if(P.id+'|'+P.updatedAt!==stamp){toast('Проект изменился, пока шла генерация. Запустите её ещё раз',true);return false;}
  const err=aiCommit(Q=>{
    if(mode==='new'){
      Q.ai={v:1,roomKey:aiRoomKey(Q),base,brief:aiClone(brief),taste:out.taste,variants:out.cells,prevVariants:null,active:'base',chosen:null};
      Q.brief=aiClone(brief);Q.briefDraft=null;Q.showAiBadges=true;(Q.furniture||[]).forEach(f=>{f.aiPolicy=(brief.policies||{})[f.id]||'free';});
    }else{
      aiStoreActive(Q);aiLoadCell(Q,Q.ai.base);
      Q.ai.prevVariants=Q.ai.variants;Q.ai.variants=out.cells;Q.ai.active='base';Q.ai.chosen=Q.ai.chosen==='base'?'base':null;Q.ai.taste=out.taste;
    }
    Q.status='submitted';
  });
  if(err){toast(err,true);return false;}
  if(out.runsLeft!=null)AI_RUNS_LEFT=out.runsLeft;
  if(out.taste&&out.taste.missing)toast(`Фото не найдены ни на этом устройстве, ни в аккаунте и не учтены: ${out.taste.missing}`,true);
  E.propsOpen=false;showResult();return true;
}
/* Поменять местами нынешние и прежние варианты */
function aiSwapPrev(){
  if(!aiHasVariants()||!P.ai.prevVariants)return;
  const err=aiCommit(Q=>{aiStoreActive(Q);aiLoadCell(Q,Q.ai.base);const cur=Q.ai.variants;Q.ai.variants=Q.ai.prevVariants;Q.ai.prevVariants=cur;Q.ai.active='base';Q.ai.chosen=Q.ai.chosen==='base'?'base':null;});
  if(err)toast(err,true);else showResult();
}
function aiChoose(which){if(!aiHasVariants()){showResult();return;}const err=aiCommit(Q=>{Q.ai.chosen=Q.ai.chosen===which?null:which;});if(err)toast(err,true);else showResult();}
