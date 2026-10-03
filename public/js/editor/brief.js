'use strict';
/* furnitech · редактор · brief.js
   Завершение: мастер брифа для ИИ‑дизайнера и экран результата.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ---------- Этап 3: завершение ---------- */
function briefSummary(){const items=P.furniture||[];return {locked:items.filter(f=>f.locked&&f.productId).length,free:items.filter(f=>!f.locked&&f.productId).length,ph:items.filter(f=>!f.productId).length};}
/* Права ИИ по замкам (ТЗ 46.2, правила 2–3) */
function lockPolicy(f){return f.locked?(f.productId?'keep':'replace'):'free';}
/* Сохранённое право: из черновика брифа или с прошлой отправки (правило 1) */
function savedPolicy(f){const d=P.briefDraft&&P.briefDraft.policies;const p=(d&&d[f.id])||f.aiPolicy||null;if(!p)return null;return (!f.productId&&p==='keep')?'replace':p;}
function initialPolicies(){const m=new Map();for(const f of P.furniture||[])m.set(f.id,savedPolicy(f)||lockPolicy(f));return m;}
function hasSavedPolicies(){return (P.furniture||[]).some(f=>savedPolicy(f));}
function defaultRoom(){const anyWall=P.walls.some(w=>w.material);return {walls:anyWall?'keep':'ai',floor:(P.floor?.material&&!(P.floor.material.type==='color'&&P.floor.material.color===FLOOR_DEF))?'keep':'ai',ceiling:'ai',lighting:'ai'};}
/* ТЗ 47.1 */
function calcNeedsBrief(policies,room){return [...policies.values()].some(p=>p!=='keep')||Object.values(room).some(v=>v==='ai');}
function meaningfulText(s){s=(s||'').trim();return s.length>=10&&((s.match(/\p{L}/gu)||[]).length>=3);}
function photoError(p){
  if(!p.likes.length&&(p.comment||'').trim().length<10)return 'Отметьте, что нравится, или опишите это в комментарии (от 10 символов)';
  if(p.likes.includes('furniture')&&p.furnitureTypes!=='all'&&!(p.furnitureTypes||[]).length)return 'Какая мебель на фото нравится?';
  return null;
}
function hasSignal(photos,prefs){return photos.some(p=>p.likes.length>0)||['style','palette'].some(k=>prefs[k]&&prefs[k]!=='Неважно');}
function saveBriefDraft(st){const policies={};if(st.policies)st.policies.forEach((v,k)=>policies[k]=v);apply(Q=>{Q.briefDraft={policies,room:st.room,photos:st.photos,text:st.text,prefs:st.prefs};},{noHist:true});}

async function finishFlow(){
  if(READONLY){toast(READONLY_MSG);return;}
  if(P.mode!=='furniture')return; if(!(P.furniture||[]).length){toast('Расставьте хотя бы один предмет или пустышку',true);return;}
  const draft=P.briefDraft||P.brief||{};
  const st={policies:initialPolicies(),room:Object.assign({},draft.room||defaultRoom()),photos:(draft.photos||[]).map(p=>Object.assign({likes:[],furnitureTypes:[],comment:''},p,{likes:[...(p.likes||[])],furnitureTypes:p.furnitureTypes==='all'?'all':[...(p.furnitureTypes||[])]})),text:draft.text||'',prefs:Object.assign({},draft.prefs||{})};
  let step=1;
  while(true){
    if(step===1){const r=await rightsDialog(st);if(!r){saveBriefDraft(st);return;}st.policies=r.policies;st.room=r.room;step=2;}
    else{const r=await wishesDialog(st);st.photos=r.photos;st.text=r.text;st.prefs=r.prefs;if(r.cancel){saveBriefDraft(st);return;}if(r.back){step=1;continue;}submitBrief(st);return;}
  }
}
/* Шаг 1 из 2 — права (бывший шаг 2) */
async function rightsDialog(st){
  return dialog((box,api)=>{
    box.classList.add('xwide'); box.append(h('h3',{},'Шаг 1 из 2 — что может менять ИИ‑дизайнер'));
    const s=briefSummary(); box.append(h('div',{class:'summary'},h('span',{},'Заперто: ',h('b',{},String(s.locked))),h('span',{},'Свободно: ',h('b',{},String(s.free))),h('span',{},'Пустышек: ',h('b',{},String(s.ph)))));
    box.append(h('div',{class:'hint'},'Замок в редакторе и права ИИ — разные вещи. Замок мешает только вам случайно сдвинуть предмет; здесь вы решаете, что разрешено ИИ. Права заполнены по замкам — поменяйте, если нужно.'));
    const pol=new Map(st.policies); const items=P.furniture||[];
    const segFor=(f)=>{const seg=h('div',{class:'seg',role:'group','aria-label':'Права ИИ: '+f.name});const ph=!f.productId;['keep','move','replace','free'].forEach(p=>{const b=h('button',{type:'button',class:pol.get(f.id)===p?'on':'','aria-pressed':String(pol.get(f.id)===p),title:AI_NAME[p],onclick:()=>{pol.set(f.id,p);[...seg.children].forEach(x=>{const on=x.textContent===AI_NAME[p];x.classList.toggle('on',on);x.setAttribute('aria-pressed',String(on));});}},AI_NAME[p]);if(ph&&p==='keep'){b.disabled=true;b.title='Пустышка: ИИ обязан подобрать товар';}seg.append(b);});return seg;};
    const table=h('div',{class:'aitable'});
    const all=h('div',{class:'seg',role:'group','aria-label':'Права ИИ для всех предметов'});['keep','move','replace','free'].forEach(p=>all.append(h('button',{type:'button',onclick:()=>{items.forEach(f=>{pol.set(f.id,(p==='keep'&&!f.productId)?'replace':p);});fill();}},AI_NAME[p])));
    const fill=()=>{table.innerHTML='';
      const hd=h('div',{class:'hd'},h('span',{},`Предметы: ${items.length}`),h('span',{},'Всем: ',all));
      if(hasSavedPolicies())hd.append(h('button',{type:'button',class:'rst',onclick:()=>{items.forEach(f=>pol.set(f.id,lockPolicy(f)));fill();}},'Сбросить по замкам'));
      table.append(hd);
      items.forEach(f=>{const t=TYPE.get(f.typeId),fo=formOf(t,f.formId);table.append(h('div',{class:'airow'},h('img',{src:typeIcon(t),alt:'',width:'36',height:'36'}),h('div',{class:'nm'},f.name,h('small',{},(f.productId?'Товар':'Пустышка')+' · '+fo.dims.map(k=>fmt(f.dims[k])).join('×')+' '+UNITS[P.unit].l+(f.locked?' · заперт':''))),segFor(f)));});};
    fill(); box.append(table);
    const rm=Object.assign({},st.room); const blk=h('div',{class:'roomblk'},h('h5',{},'Комната'));
    [['walls','Материалы стен'],['floor','Пол'],['ceiling','Потолок'],['lighting','Освещение и декор']].forEach(([k,nm])=>{const seg=h('div',{class:'seg',role:'group','aria-label':nm});[['keep','Как есть'],['ai','На усмотрение ИИ']].forEach(([v,l])=>seg.append(h('button',{type:'button',class:rm[k]===v?'on':'','aria-pressed':String(rm[k]===v),onclick:()=>{rm[k]=v;[...seg.children].forEach(x=>{const on=x.textContent===l;x.classList.toggle('on',on);x.setAttribute('aria-pressed',String(on));});}},l)));blk.append(h('span',{},nm),seg);});
    box.append(blk);
    api.buttons=[{label:'Отмена',cancel:true,onClick:a=>{st.policies=pol;st.room=rm;a.close(null);}},{label:'Далее',primary:true,onClick:a=>a.close({policies:pol,room:rm})}];
  });
}
const LIKES=[['style','Стиль в целом'],['colors','Цвета'],['furniture','Мебель'],['walls','Стены'],['floor','Пол'],['ceiling','Потолок'],['lighting','Освещение'],['decor','Декор'],['layout','Расположение']];
const PREFS={style:['Современный','Скандинавский','Лофт','Классика','Минимализм','Японди','Бохо','Неважно'],palette:['Светлая','Тёмная','Тёплая','Холодная','Контрастная','Неважно'],budget:['Экономно','Средний','Премиум','Неважно']};
/* Шаг 2 из 2 — пожелания (бывший шаг 3), правило обязательности текста ТЗ 47 */
async function wishesDialog(st){
  return dialog((box,api)=>{
    box.classList.add('xwide');
    const photos=st.photos.map(p=>Object.assign({},p)); let text=st.text||''; const prefs=Object.assign({},st.prefs);
    const needs=calcNeedsBrief(st.policies,st.room); let tried=false;
    box.append(h('h3',{},needs?'Шаг 2 из 2 — пожелания':'Шаг 2 из 2 — рендер'));
    const out=(extra)=>Object.assign({photos,text,prefs},extra);
    if(!needs){
      box.append(h('div',{class:'infoblk'},ic('info'),h('div',{},'ИИ ничего не будет менять. Вы получите фотореалистичные виды комнаты в текущем виде.')));
      api.buttons=[{label:'Назад',onClick:a=>a.close(out({back:true}))},{label:'Отмена',cancel:true,onClick:a=>a.close(out({cancel:true}))},{label:'Получить рендер',primary:true,onClick:a=>a.close(out({}))}];
      return;
    }
    const list=h('div',{});
    const file=h('input',{type:'file',accept:'image/jpeg,image/png,image/webp',multiple:''});
    const drop=h('div',{class:'drop'},ic('upload'),' Перетащите фото сюда, вставьте из буфера или ',h('label',{class:'lnk'},'выберите файлы',file),h('div',{class:'hint'},'До 10 фото. По каждому отметьте, что именно нравится.'));
    const add=async(files)=>{for(const f of [...files]){if(photos.length>=10){toast('Не больше 10 фото',true);break;}try{const id=await importPhoto(f);photos.push({photoId:id,likes:[],furnitureTypes:[],comment:''});}catch(e){toast(e.message,true);}}fill();};
    file.onchange=()=>add(file.files); drop.ondragover=e=>{e.preventDefault();drop.classList.add('over');}; drop.ondragleave=()=>drop.classList.remove('over'); drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');add(e.dataTransfer.files);};
    box.onpaste=e=>{const its=[...(e.clipboardData?.items||[])].filter(i=>i.type.startsWith('image/'));if(its.length)add(its.map(i=>i.getAsFile()));};
    box.append(drop);if(typeof photoNote==='function'){const pn=photoNote();if(pn)box.append(pn);}box.append(list);
    const lbl=h('div',{class:'fld-lbl'});
    const ta=h('textarea',{rows:'4',placeholder:'Опишите, что хотите получить: настроение, цвета, материалы, что обязательно, чего избегать…',maxlength:'600'});ta.value=text;ta.oninput=()=>{text=ta.value;refresh();};
    const taErr=h('div',{class:'err',style:'min-height:0;margin:4px 0 0'});
    box.append(lbl,ta,taErr);
    const pref=h('div',{}); [['style','Стиль'],['palette','Палитра'],['budget','Бюджет']].forEach(([k,nm])=>{const ch=h('div',{class:'chips'});const rebuild=()=>{ch.innerHTML='';PREFS[k].forEach(v=>ch.append(h('button',{type:'button',class:'chip'+(prefs[k]===v?' on':''),onclick:()=>{prefs[k]=prefs[k]===v?undefined:v;rebuild();refresh();}},v)));};rebuild();pref.append(h('div',{class:'hint'},nm),ch);});
    box.append(h('div',{class:'hint',style:'margin-top:10px'},'Быстрые предпочтения (необязательно)'),pref);
    const stline=h('div',{class:'stline'},'Чтобы отправить, загрузите фото и отметьте, что нравится, выберите стиль или опишите пожелания словами'); box.append(stline);
    const cards=[];
    function fill(){list.innerHTML='';cards.length=0;photos.forEach((p,idx)=>{const card=h('div',{class:'pcard'});const img=h('img',{alt:''});IDB.get(p.photoId).then(rec=>{if(rec)img.src=URL.createObjectURL(rec.blob);});
      const chips=h('div',{class:'chips'});LIKES.forEach(([k,nm])=>chips.append(h('button',{type:'button',class:'chip'+(p.likes.includes(k)?' on':''),onclick:()=>{const i=p.likes.indexOf(k);if(i>=0)p.likes.splice(i,1);else p.likes.push(k);fill();}},nm)));
      const body=h('div',{},h('div',{class:'pc-h'},h('span',{},`Фото ${idx+1} — что здесь нравится`),h('button',{class:'ghost',type:'button',onclick:()=>{photos.splice(idx,1);fill();}},ic('trash'),'Убрать')),chips);
      if(p.likes.includes('furniture')){const fch=h('div',{class:'chips'});const q=h('input',{type:'search',placeholder:'Какая мебель? Поиск по типам…',style:'height:30px;width:100%'});
        const fillT=()=>{fch.innerHTML='';const isAll=p.furnitureTypes==='all';fch.append(h('button',{type:'button',class:'chip'+(isAll?' on':''),onclick:()=>{p.furnitureTypes=isAll?[]:'all';fillT();refresh();}},'Вся мебель'));
          if(!isAll){const qq=q.value.toLowerCase();const sel=TYPES.filter(t=>p.furnitureTypes.includes(t.id));const rest=TYPES.filter(t=>!p.furnitureTypes.includes(t.id)&&(qq?t.name.toLowerCase().includes(qq):false)).slice(0,12);[...sel,...rest].forEach(t=>fch.append(h('button',{type:'button',class:'chip'+(p.furnitureTypes.includes(t.id)?' on':''),onclick:()=>{const i=p.furnitureTypes.indexOf(t.id);if(i>=0)p.furnitureTypes.splice(i,1);else p.furnitureTypes.push(t.id);fillT();refresh();}},t.name)));if(!sel.length&&!qq)fch.append(h('span',{class:'hint'},'Начните вводить: диван, стол…'));}};
        q.oninput=fillT;fillT();body.append(q,fch);}
      const cm=h('textarea',{rows:'2',maxlength:'300',placeholder:'Комментарий, например: нравится сочетание дерева и серого'});cm.value=p.comment||'';cm.oninput=()=>{p.comment=cm.value;refresh();};body.append(cm);
      const perr=h('div',{class:'pc-err'});body.append(perr);
      card.append(img,body);list.append(card);cards.push({card,perr});});
      refresh();}
    function refresh(){
      const ok=hasSignal(photos,prefs)||meaningfulText(text);
      lbl.textContent=hasSignal(photos,prefs)?'Пожелания (необязательно)':'Пожелания — обязательно, если нет фото с отметками или выбранного стиля';
      stline.hidden=ok;
      if(tried){cards.forEach((c,i)=>{const e=photoError(photos[i]);c.card.classList.toggle('bad',!!e);c.perr.textContent=e||'';});const tErr=!ok;ta.classList.toggle('bad',tErr);taErr.textContent=tErr?(text.trim()?'Опишите подробнее — хотя бы 10 символов':'Загрузите фото с отметками, выберите стиль или опишите пожелания'):'';}
      if(api.errEl)api.errEl.textContent='';
    }
    fill();
    api.buttons=[{label:'Назад',onClick:a=>a.close(out({back:true}))},{label:'Отмена',cancel:true,onClick:a=>a.close(out({cancel:true}))},{label:'Отправить дизайнеру',primary:true,onClick:a=>{
      tried=true; refresh();
      const badIdx=photos.findIndex(p=>photoError(p)); if(badIdx>=0){cards[badIdx].card.scrollIntoView({block:'center',behavior:'smooth'});return;}
      if(!(hasSignal(photos,prefs)||meaningfulText(text))){ta.scrollIntoView({block:'center',behavior:'smooth'});ta.focus();return;}
      a.close(out({}));}}];
  });
}
function submitBrief(st){
  const briefItems=(P.furniture||[]).map(f=>({id:f.id,typeId:f.typeId,formId:f.formId,formAny:!!f.formAny,productId:f.productId,dims:f.dims,constraints:f.constraints,x:f.x,y:f.y,rot:f.rot,mirror:!!f.mirror,aiPolicy:st.policies.get(f.id)||'free'}));
  const brief={schemaVersion:2,createdAt:new Date().toISOString(),room:st.room,photos:st.photos,text:st.text||'',prefs:st.prefs,items:briefItems};
  const err=apply(Q=>{Q.brief=brief;Q.briefDraft=null;Q.status='submitted';Q.showAiBadges=true;(Q.furniture||[]).forEach(f=>{f.aiPolicy=st.policies.get(f.id)||'free';});}); if(err){toast(err,true);return;}
  E.sel=null;E.propsOpen=false;showResult();
}
function showResult(){
  const r=$('#result'); r.hidden=false; r.innerHTML=''; const b=P.brief; if(!b){r.hidden=true;return;} document.body.classList.add('res');
  const wrap=h('div',{class:'wrap'}); r.append(wrap);
  wrap.append(h('h2',{},'Итоговый вариант'),h('div',{class:'hint'},'Бриф сохранён. Здесь появится результат ИИ‑дизайнера (этап 4–5). Пока — 4 вида комнаты и сводка брифа.'));
  const c=polyCentroid(innerPoly()||[{x:0,y:0}]); const pi=nearestPointTo(c);
  const views=h('div',{class:'views'}); [['Вид 0°',0],['Вид 90°',Math.PI/2],['Вид 180°',Math.PI],['Вид 270°',Math.PI*1.5]].forEach(([nm,yaw])=>views.append(h('button',{onclick:()=>enter3D(pi,{yaw})},ic('eye'),nm)));
  wrap.append(h('div',{class:'card'},h('h4',{},'4 вида из центра комнаты'),views,h('div',{class:'hint'},`Точка обзора ${pi+1}. Esc — вернуться сюда.`)));
  const s=briefSummary(); const pol={};(P.furniture||[]).forEach(f=>{pol[f.aiPolicy||'free']=(pol[f.aiPolicy||'free']||0)+1;});
  const card=h('div',{class:'card'},h('h4',{},'Сводка брифа'),h('div',{class:'row'},h('span',{},'Предметы'),h('span',{},`${s.locked+s.free} товаров, ${s.ph} пустышек`)),h('div',{class:'row'},h('span',{},'Права ИИ'),h('span',{},Object.keys(pol).map(k=>`${AI_NAME[k]}: ${pol[k]}`).join(' · '))),h('div',{class:'row'},h('span',{},'Комната'),h('span',{},['walls','floor','ceiling','lighting'].map(k=>({walls:'стены',floor:'пол',ceiling:'потолок',lighting:'свет'})[k]+': '+(b.room[k]==='keep'?'как есть':'ИИ')).join(' · '))));
  if(b.prefs&&Object.values(b.prefs).some(Boolean))card.append(h('div',{class:'row'},h('span',{},'Предпочтения'),h('span',{},Object.values(b.prefs).filter(Boolean).join(' · '))));
  if(b.text)card.append(h('div',{class:'row'},h('span',{},'Пожелания'),h('span',{},b.text)));
  wrap.append(card);
  const ph=h('div',{class:'card'},h('h4',{},`Фото‑референсы (${b.photos.length})`)); const pl=h('div',{class:'photos'}); ph.append(pl);
  b.photos.forEach(p=>{const im=h('img',{alt:'',title:p.likes.map(k=>LIKES.find(x=>x[0]===k)?.[1]).join(', ')+(p.comment?' — '+p.comment:'')});IDB.get(p.photoId).then(rec=>{if(rec)im.src=URL.createObjectURL(rec.blob);});pl.append(im);}); if(!b.photos.length)pl.append(h('span',{class:'hint'},'Без фото'));
  wrap.append(ph);
  const it=h('div',{class:'card'},h('h4',{},'Предметы и права')); (P.furniture||[]).forEach(f=>it.append(h('div',{class:'row'},h('span',{},f.name),h('span',{},AI_NAME[f.aiPolicy||'free'])))); wrap.append(it);
  if(typeof onResultShown==='function')onResultShown(wrap);
  wrap.append(h('div',{class:'acts'},h('button',{onclick:()=>showBriefJson()},ic('copy'),'Бриф (JSON)'),h('button',{class:'primary',onclick:()=>{const err=apply(Q=>{Q.status='draft';},{noHist:true});if(err)toast(err,true);r.hidden=true;document.body.classList.remove('res');render();}},'Вернуться к редактированию')));
}
function showBriefJson(){const json=JSON.stringify({room:{vertices:P.vertices,walls:P.walls,openings:P.openings,wallHeight:P.wallHeight,wallThickness:P.wallThickness,floor:P.floor},brief:P.brief},null,2);dialog((box,api)=>{box.classList.add('wide');box.append(h('h3',{},'Бриф для этапа 4'));const ta=h('textarea',{rows:'16',readonly:''});ta.value=json;box.append(ta);api.buttons=[{label:'Копировать',onClick:()=>{navigator.clipboard?.writeText(json).then(()=>toast('Скопировано'),()=>{ta.select();toast('Выделите и скопируйте вручную');});}},{label:'Закрыть',primary:true,cancel:true,onClick:a=>a.close(null)}];});}
function toggleMatPanel(){P.panelCollapsed=!P.panelCollapsed;save();$('#matPanel').classList.toggle('collapsed',P.panelCollapsed);}
