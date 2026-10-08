'use strict';
/* furnitech · редактор · ai/result.js
   ИИ‑дизайнер: экран результата (два варианта и исходная расстановка) и полоса переключения вариантов над планом.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */

/* ---------- что изменил ИИ ---------- */
function aiSamePlace(a,b){
  if(aiMount(a)==='wall')return a.wallId===b.wallId&&Math.abs((a.offset||0)-(b.offset||0))<=1&&Math.abs((a.elev||0)-(b.elev||0))<=1;
  const dr=Math.abs(aiNorm(a.rot||0)-aiNorm(b.rot||0));return Math.abs(a.x-b.x)<=1&&Math.abs(a.y-b.y)<=1&&Math.min(dr,360-dr)<=0.5;
}
/* → Map(id → 'new' товар подобран или заменён | 'moved' переставлен | 'both') для предметов клетки относительно исходной расстановки */
function aiChanges(cell,base){
  const m=new Map(),by=new Map((base.furniture||[]).map(f=>[f.id,f]));
  for(const f of cell.furniture||[]){const b=by.get(f.id);if(!b)continue;const np=(f.productId||null)!==(b.productId||null),mv=!aiSamePlace(f,b);if(np||mv)m.set(f.id,np&&mv?'both':np?'new':'moved');}
  return m;
}

/* ---------- мини‑план ---------- */
/* sheet — {w, h}: рисунок заданного размера в светлых цветах, независимо от темы (для печати сметы) */
function aiMiniPlan(cv,cell,changed,sheet){
  const poly=innerPoly();if(!poly)return;
  const css=getComputedStyle(document.documentElement),col=(n,d)=>sheet?d:(css.getPropertyValue(n).trim()||d);
  const dpr=sheet?2:Math.min(2,window.devicePixelRatio||1),W=sheet?sheet.w:(cv.clientWidth||320),H=sheet?sheet.h:(cv.clientHeight||220);cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);
  const x=cv.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,W,H);
  const bb=aabbOf(poly),pad=14,k=Math.min((W-2*pad)/Math.max(1,bb.w),(H-2*pad)/Math.max(1,bb.h)),ox=(W-bb.w*k)/2-bb.x0*k,oy=(H-bb.h*k)/2-bb.y0*k;
  const X=(p)=>p.x*k+ox,Y=(p)=>p.y*k+oy;
  const path=(pts)=>{x.beginPath();pts.forEach((p,i)=>i?x.lineTo(X(p),Y(p)):x.moveTo(X(p),Y(p)));x.closePath();};
  const fin=cell.finishes||{};const floor=fin.floor&&fin.floor.type==='color'?fin.floor.color:null;
  path(poly);x.fillStyle=floor||col('--grid','#efeff1');x.globalAlpha=floor?0.55:1;x.fill();x.globalAlpha=1;
  const Q={vertices:P.vertices,walls:P.walls,openings:P.openings,wallHeight:P.wallHeight,furniture:cell.furniture||[]};
  const order={under:0,floor:1,ontop:2};
  const items=[...(cell.furniture||[])].filter(f=>TYPE.get(f.typeId)).sort((a,b)=>order[TYPE.get(a.typeId).layer]-order[TYPE.get(b.typeId).layer]);
  const accent=col('--brand','#2563eb'),ink=col('--wall','#27272a'),paper=col('--card','#fff');
  for(const f of items){const pts=fWorldOf(f,Q,D);if(!pts)continue;const ch=changed&&changed.has(f.id);
    /* ковёр лежит под мебелью: рисуется бледной подложкой, чтобы не спорить с предметами на нём */
    const rug=TYPE.get(f.typeId).layer==='under';
    path(pts);x.fillStyle=ch?accent:(rug?ink:paper);x.globalAlpha=rug?(ch?0.10:0.06):(ch?0.22:0.9);x.fill();x.globalAlpha=rug?0.45:1;
    x.lineWidth=rug?1:(ch?1.6:1);x.strokeStyle=ch?accent:ink;x.setLineDash(rug?[2,3]:f.productId?[]:[4,3]);x.stroke();x.setLineDash([]);x.globalAlpha=1;}
  path(poly);x.lineWidth=2.5;x.strokeStyle=ink;x.lineJoin='round';x.stroke();
  /* проёмы: окно — светлый отрезок, дверь и арка — разрыв стены */
  for(const o of P.openings){const i=D.W.get(o.wallId);if(!i)continue;const a={x:i.ref.x+i.rx*o.offset,y:i.ref.y+i.ry*o.offset},b={x:i.ref.x+i.rx*(o.offset+o.width),y:i.ref.y+i.ry*(o.offset+o.width)};
    x.beginPath();x.moveTo(X(a),Y(a));x.lineTo(X(b),Y(b));x.lineWidth=3.5;x.strokeStyle=o.kind==='window'?col('--brand','#2563eb'):paper;x.globalAlpha=o.kind==='window'?0.75:1;x.stroke();x.globalAlpha=1;}
}

/* ---------- части карточки ---------- */
function aiSwatch(name,m,same){
  const s=h('i',{class:'sw'});
  if(m&&m.type==='color')s.style.background=m.color;
  else if(m&&m.type==='texture'){const c=getLibCanvas(m.textureId);if(c)s.style.backgroundImage=`url(${c.toDataURL()})`;}
  else if(m&&m.type==='photo')s.classList.add('ph');
  const lib=m&&m.type==='texture'&&TEXLIB.find(t=>t.id===m.textureId);
  return h('span',{class:'aisw'+(same?' same':''),title:name+': '+(lib?lib.name:m&&m.type==='color'?'краска '+m.color:m&&m.type==='photo'?'своё фото':'по умолчанию')},s,name);
}
function aiFinishRow(cell,base){
  const fin=cell.finishes||{walls:{}},b=(base&&base.finishes)||{walls:{}};const eq=(a,c)=>JSON.stringify(a||null)===JSON.stringify(c||null);
  const firstWall=(f)=>{const ids=Object.keys(f.walls||{});return ids.length?f.walls[ids[0]]:null;};
  const wallsSame=Object.keys(fin.walls||{}).every(id=>eq(fin.walls[id],(b.walls||{})[id]));
  return h('div',{class:'aifin'},aiSwatch('Стены',firstWall(fin)||{type:'color',color:WALL_DEF},wallsSame),aiSwatch('Пол',fin.floor||{type:'color',color:FLOOR_DEF},eq(fin.floor,b.floor)),aiSwatch('Потолок',fin.ceiling||{type:'color',color:CEIL_DEF},eq(fin.ceiling,b.ceiling)));
}
/* Список товаров клетки: одинаковые товары одной строкой, изменённые ИИ — сверху. → {el, total:'5 400 Br + …', count} */
function aiItemsList(cell,changed){
  const rows=new Map();
  for(const f of cell.furniture||[]){const t=TYPE.get(f.typeId);if(!t)continue;const key=f.productId||('ph:'+f.id);
    if(!rows.has(key))rows.set(key,{f,t,pr:f.productId?PRODUCT_BY_ID.get(f.productId):null,n:0,ch:new Set()});
    const r=rows.get(key);r.n++;if(changed&&changed.has(f.id))r.ch.add(changed.get(f.id));}
  const list=[...rows.values()].sort((a,b)=>(b.ch.size?1:0)-(a.ch.size?1:0)||(b.f.productId?1:0)-(a.f.productId?1:0));
  const sums=new Map();let count=0;
  const el=h('div',{class:'aiitems'});
  for(const r of list){const {f,t,pr}=r;const fo=formOf(t,f.formId);
    const dims=fo.dims.map(k=>fmt(f.dims[k])).join('×')+'×'+fmt(f.dims.H||0)+' '+UNITS[P.unit].l;
    const mark=r.ch.has('new')||r.ch.has('both')?(r.ch.has('both')?'подобран и переставлен':'подобран ИИ'):r.ch.has('moved')?'переставлен':'';
    const img=h('img',{alt:'',width:'44',height:'44',loading:'lazy'});img.src=pr?productThumb(pr):typeIcon(t);if(!pr||!(pr.images&&pr.images.length))img.className='gen';
    const price=pr&&pr.price>0?fmtPrice(pr.price*r.n,pr.currency):'';
    if(pr&&pr.price>0){sums.set(pr.currency||'RUB',(sums.get(pr.currency||'RUB')||0)+pr.price*r.n);}
    if(f.productId)count+=r.n;
    const nm=h('div',{class:'nm'},h('b',{},(f.productId?f.name:'Пустышка: '+f.name)+(r.n>1?` ×${r.n}`:'')),h('small',{},t.name+' · '+dims+(pr&&pr.brand?' · '+pr.brand:'')));
    if(mark)nm.append(h('em',{},mark));
    const right=h('div',{class:'pr'},price?h('span',{},price):h('span',{class:'mut'},f.productId?'цена не указана':'товар не выбран'));
    if(pr&&pr.url&&/^https?:\/\//.test(pr.url))right.append(h('a',{href:pr.url,target:'_blank',rel:'noopener noreferrer'},'Страница товара'));
    el.append(h('div',{class:'it'+(f.productId?'':' ph')},img,nm,right));}
  const total=[...sums.entries()].map(([c,v])=>fmtPrice(Math.round(v),c)).join(' + ');
  return {el,total,count};
}
function aiCard(which){
  const ai=P.ai,cell=aiCellOf(ai,which),isBase=which==='base',chosen=ai.chosen===which;
  const card=h('div',{class:'card aivar'+(isBase?' base':'')+(chosen?' chosen':'')+(cell.failed?' failed':''),'data-cell':String(which)});
  const head=h('div',{class:'aihead'},h('h4',{},isBase?'Исходная расстановка':(cell.title||`Вариант ${which+1}`)));
  if(!isBase)head.prepend(h('span',{class:'num'},`Вариант ${which+1}`));
  if(chosen)head.append(h('span',{class:'badge'},ic('check'),'Выбран'));
  if(cell.failed){card.append(head,h('div',{class:'pnote warn',role:'status'},ic('alert'),h('div',{},h('b',{},'Вариант не построен'),cell.failed)),h('div',{class:'hint'},'Нажмите «Сгенерировать заново» — ИИ предложит другие решения.'));return card;}
  const changed=isBase?null:aiChanges(cell,ai.base);
  const cv=h('canvas',{class:'aiplan','aria-label':'План: '+aiCellName(ai,which)});card.append(cv);requestAnimationFrame(()=>aiMiniPlan(cv,cell,changed));
  card.append(head);
  if(isBase)card.append(h('p',{class:'note'},'То, что вы расставили сами, — без изменений.'));
  else if(cell.note)card.append(h('p',{class:'note'},cell.note));
  card.append(aiFinishRow(cell,ai.base));
  const items=aiItemsList(cell,changed);
  if(!isBase){const nNew=[...changed.values()].filter(v=>v!=='moved').length,nMoved=[...changed.values()].filter(v=>v!=='new').length;
    card.append(h('div',{class:'summary'},h('span',{},'Подобрано товаров: ',h('b',{},String(nNew))),h('span',{},'Переставлено: ',h('b',{},String(nMoved))),items.total?h('span',{},'Вся мебель: ',h('b',{},items.total)):null));}
  else if(items.total)card.append(h('div',{class:'summary'},h('span',{},'Вся мебель: ',h('b',{},items.total))));
  for(const w of cell.warnings||[])card.append(h('div',{class:'pnote warn',role:'status'},ic('alert'),h('div',{},w.text)));
  const det=h('details',{},h('summary',{},`Товары и предметы (${(cell.furniture||[]).length})`));det.append(items.el);if(!isBase)det.open=true;card.append(det);
  const acts=h('div',{class:'aiacts'});
  acts.append(h('button',{type:'button',onclick:()=>aiView3D(which)},ic('eye'),'3D'),h('button',{type:'button',onclick:()=>aiOpenPlan(which)},'Открыть план'));
  if(!READONLY){
    if(!isBase)acts.append(h('button',{type:'button',onclick:()=>aiRefineDialog(which)},'Доработать'));
    acts.append(h('button',{type:'button',class:chosen?'':'primary','aria-pressed':String(chosen),onclick:()=>aiChoose(which)},chosen?'Отменить выбор':isBase?'Оставить исходную':'Выбрать этот вариант'));
  }
  card.append(acts);return card;
}

/* ---------- экран результата ---------- */
/* force — показать экран, даже если проект не отправлен (просмотр поддержкой: состояние проекта менять нельзя) */
function showResult(force){
  const r=$('#result');if(!r)return;
  aiCheckStale();
  if(P.status==='submitted')aiSyncActive(); // правки, сделанные на плане или в 3D, должны попасть в карточку своего варианта
  if(!((P.status==='submitted'||(force===true&&aiHasVariants()))&&(P.brief||P.ai))){r.hidden=true;document.body.classList.remove('res');aiBar();return;}
  r.hidden=false;r.innerHTML='';document.body.classList.add('res');aiBar();
  const wrap=h('div',{class:'wrap'});r.append(wrap);
  const back=()=>{const err=READONLY?null:aiCommit(Q=>{Q.status='draft';});if(err)toast(err,true);r.hidden=true;document.body.classList.remove('res');aiBar();render();};
  if(!aiHasVariants()){
    /* ИИ‑дизайнеру нечего было менять: всё остаётся как есть */
    wrap.append(h('h2',{},'Расстановка сохранена'),h('div',{class:'hint'},'ИИ‑дизайнер ничего не менял: все предметы и отделка остаются такими, как вы их задали. Рендер появится на следующем этапе.'));
    const c=polyCentroid(innerPoly()||[{x:0,y:0}]);const pi=nearestPointTo(c);
    const views=h('div',{class:'views'});[['Вид 0°',0],['Вид 90°',Math.PI/2],['Вид 180°',Math.PI],['Вид 270°',Math.PI*1.5]].forEach(([nm,yaw])=>views.append(h('button',{onclick:()=>enter3D(pi,{yaw})},ic('eye'),nm)));
    wrap.append(h('div',{class:'card'},h('h4',{},'4 вида из центра комнаты'),views,h('div',{class:'hint'},'Esc — вернуться сюда.')));
    const ob0=orderBlock([null]);if(ob0)wrap.append(ob0);
    wrap.append(h('div',{class:'acts'},h('button',{class:'primary',onclick:back},'Вернуться к редактированию')));
    return;
  }
  const ai=P.ai;
  wrap.classList.add('ai');
  wrap.append(h('h2',{},'Варианты ИИ‑дизайнера'));
  const hint=h('div',{class:'hint'},'Сравните варианты: на планах выделено то, что изменил ИИ. Любой вариант можно открыть на плане и в 3D'+(READONLY?'.':', поправить вручную или доработать.'));
  if(AI_RUNS_LEFT!=null)hint.append(' ',h('span',{class:'runs'},`Сегодня осталось генераций: ${AI_RUNS_LEFT}.`));
  wrap.append(hint);
  ai.variants.forEach((v,i)=>wrap.append(aiCard(i)));
  wrap.append(aiCard('base'));
  if(ai.chosen!=null)wrap.append(h('div',{class:'infoblk aichosen'},ic('info'),h('div',{},`Выбрано: «${aiCellName(ai,ai.chosen)}». Фотореалистичный рендер выбранного варианта появится на следующем этапе.`)));
  const ob=orderBlock([...ai.variants.map((v,i)=>i),'base']);if(ob)wrap.append(ob);
  const acts=h('div',{class:'acts'});
  if(!READONLY){
    if(ai.prevVariants&&ai.prevVariants.length)acts.append(h('button',{onclick:aiSwapPrev},'Вернуть прежние варианты'));
    acts.append(h('button',{onclick:aiRewish},'Изменить пожелания'),h('button',{onclick:aiAgain},ic('sparkles'),'Сгенерировать заново'));
  }
  acts.append(h('button',{class:'primary',onclick:()=>aiOpenPlan(P.ai?P.ai.active:'base')},'К плану'));
  wrap.append(acts);
}
function aiHideResult(){const r=$('#result');if(r){r.hidden=true;}document.body.classList.remove('res');}
/* Открыть клетку на плане редактора */
function aiOpenPlan(which){
  if(!aiHasVariants()){showResult();return;}
  if(READONLY){aiSwitch(which);aiHideResult();aiBar();fitRoom();render();return;}
  const e1=aiSwitch(which,'draft');if(e1){toast(e1,true);showResult();return;}
  aiHideResult();if(P.mode!=='furniture')setMode('furniture');updateModeUI();aiBar();fitRoom();render();
}
function aiView3D(which){
  if(!aiHasVariants()){showResult();return;}
  const e1=aiSwitch(which);if(e1){toast(e1,true);showResult();return;}
  const c=polyCentroid(innerPoly()||[{x:0,y:0}]);enter3D(nearestPointTo(c),{orbit:true});aiBar(); // вариант целиком — в обзоре; внутрь — кнопкой «Изнутри» или кликом по полу
}
async function aiAgain(){
  const ok=await confirmDlg('Сгенерировать заново?','ИИ‑дизайнер построит два новых варианта от исходной расстановки с теми же пожеланиями. Нынешние варианты можно будет вернуть кнопкой «Вернуть прежние варианты».','Сгенерировать');
  if(ok)aiStart({mode:'again'});
}
/* Доработка одного варианта: ИИ предлагает две новые версии, построенные от него */
async function aiRefineDialog(which){
  if(!aiHasVariants()){showResult();return;}
  const name=aiCellName(P.ai,which);
  const r=await dialog((box,api)=>{
    box.classList.add('mid');box.append(h('h3',{},`Доработать: ${name}`),h('div',{class:'hint'},'ИИ‑дизайнер возьмёт этот вариант за основу и предложит две новые версии. Нынешние два варианта можно будет вернуть.'));
    const ta=h('textarea',{rows:'3',maxlength:'300',placeholder:'Что изменить? Например: диван поставить к окну, мебель светлее. Можно оставить пустым.'});box.append(ta);
    api.buttons=[{label:'Отмена',cancel:true,onClick:a=>a.close(null)},{label:'Доработать',primary:true,onClick:a=>a.close({comment:ta.value})}];
  });
  if(r)aiStart({mode:'refine',from:which,comment:r.comment});
}
/* Изменить пожелания: мастер открывается на исходной расстановке, новая генерация строится от неё */
function aiRewish(){
  const e1=aiSwitch('base','draft');if(e1){toast(e1,true);showResult();return;}
  aiHideResult();if(P.mode!=='furniture')setMode('furniture');updateModeUI();aiBar();render();finishFlow();
}

/* ---------- полоса вариантов над планом ---------- */
function aiBar(){
  /* после диалогов на телефоне рабочая область могла остаться прокрученной (браузер подвёл к полю ввода) — полоса и заголовок уехали бы за край */
  const m=$('main');if(m&&m.scrollTop)m.scrollTop=0;
  let bar=$('#aiBar');
  /* при просмотре поддержкой полоса видна всегда, когда закрыт экран результата: переключение ничего не записывает */
  const show=aiHasVariants()&&(READONLY?$('#result').hidden:P.status!=='submitted');
  if(!show){if(bar)bar.hidden=true;document.body.classList.remove('aibar');return;}
  if(!bar){bar=h('div',{id:'aiBar',role:'group','aria-label':'Варианты ИИ‑дизайнера'});$('main').append(bar);}
  bar.hidden=false;bar.innerHTML='';document.body.classList.add('aibar');
  const ai=P.ai;const seg=h('div',{class:'seg'});
  const btn=(which,label)=>{const cell=aiCellOf(ai,which);const b=h('button',{type:'button',class:ai.active===which?'on':'','aria-pressed':String(ai.active===which),title:aiCellName(ai,which),onclick:()=>{const e=aiSwitch(which);if(e)toast(e,true);aiBar();if(P.mode==='furniture')buildCatalog();updateTools();}},label);if(cell&&cell.failed){b.disabled=true;b.title='Вариант не построен';}return b;};
  seg.append(btn('base','Исходная'));ai.variants.forEach((v,i)=>seg.append(btn(i,`Вариант ${i+1}`)));
  const toResult=()=>{if(T3.active)exit3D();
    if(READONLY){showResult(true);return;}
    const err=aiCommit(Q=>{aiStoreActive(Q);Q.status='submitted';});if(err){toast(err,true);return;}showResult();};
  bar.append(h('span',{class:'lbl'},'ИИ‑дизайнер'),seg,h('button',{type:'button',class:'primary',onclick:toResult},'К вариантам'));
}
