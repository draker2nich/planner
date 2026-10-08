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
function initialPolicies(){const m=new Map();for(const f of P.furniture||[])m.set(f.id,aiPolicy(f,savedPolicy(f)||lockPolicy(f)));return m;}
function hasSavedPolicies(){return (P.furniture||[]).some(f=>savedPolicy(f));}
function defaultRoom(){const anyWall=P.walls.some(w=>w.material);return {walls:anyWall?'keep':'ai',floor:(P.floor?.material&&!(P.floor.material.type==='color'&&P.floor.material.color===FLOOR_DEF))?'keep':'ai',ceiling:'ai',lighting:'ai'};}
/* ТЗ 47.1 */
/* «Освещение и декор» учитывается только на этапе рендера: ИИ‑дизайнер предметы не добавляет (см. aiNeeds в ai/build.js) */
function calcNeedsBrief(policies,room){return aiNeeds(policies,room);}
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
  if(typeof aiCheckStale==='function')aiCheckStale();
  const draft=P.briefDraft||P.brief||{};
  const st={policies:initialPolicies(),room:Object.assign({},draft.room||defaultRoom()),photos:(draft.photos||[]).map(p=>Object.assign({likes:[],furnitureTypes:[],comment:''},p,{likes:[...(p.likes||[])],furnitureTypes:p.furnitureTypes==='all'?'all':[...(p.furnitureTypes||[])]})),text:draft.text||'',prefs:Object.assign({},draft.prefs||{})};
  let step=1;
  while(true){
    if(step===1){const r=await rightsDialog(st);if(!r){saveBriefDraft(st);return;}st.policies=r.policies;st.room=r.room;step=2;}
    else{const r=await wishesDialog(st);st.photos=r.photos;st.text=r.text;st.prefs=r.prefs;if(r.cancel){saveBriefDraft(st);return;}if(r.back){step=1;continue;}await submitBrief(st);return;}
  }
}
/* Шаг 1 из 2 — права. Набор доступных прав у предмета зависит от того, что с ним вообще возможно (aiPolicyOptions),
   а под таблицей сразу видно, сможет ли ИИ‑дизайнер работать с таким планом (aiPrecheck). */
async function rightsDialog(st){
  const cfg=await aiConfig();
  return dialog((box,api)=>{
    box.classList.add('xwide'); box.append(h('h3',{},'Шаг 1 из 2 — что может менять ИИ‑дизайнер'));
    const s=briefSummary(); box.append(h('div',{class:'summary'},h('span',{},'Заперто: ',h('b',{},String(s.locked))),h('span',{},'Свободно: ',h('b',{},String(s.free))),h('span',{},'Пустышек: ',h('b',{},String(s.ph)))));
    box.append(h('div',{class:'hint'},'Замок в редакторе и права ИИ — разные вещи. Замок мешает только вам случайно сдвинуть предмет; здесь вы решаете, что разрешено ИИ. Права заполнены по замкам — поменяйте, если нужно.'));
    if(aiHasVariants())box.append(h('div',{class:'infoblk'},ic('info'),h('div',{},'Новые варианты будут построены от того, что сейчас на плане, и заменят нынешние.')));
    const items=P.furniture||[]; const pol=new Map(items.map(f=>[f.id,aiPolicy(f,st.policies.get(f.id))]));
    const rm=Object.assign({},st.room);
    const mark=(seg,p)=>[...seg.children].forEach(x=>{const on=x.dataset.p===p;x.classList.toggle('on',on);x.setAttribute('aria-pressed',String(on));});
    const segFor=(f)=>{const seg=h('div',{class:'seg',role:'group','aria-label':'Права ИИ: '+f.name});const opts=aiPolicyOptions(f);
      ['keep','move','replace','free'].forEach(p=>{const b=h('button',{type:'button','data-p':p,title:opts[p]||AI_NAME[p],onclick:()=>{pol.set(f.id,p);mark(seg,p);refreshSoon();}},AI_NAME[p]);if(opts[p])b.disabled=true;seg.append(b);});
      mark(seg,pol.get(f.id));return seg;};
    const table=h('div',{class:'aitable'});
    const all=h('div',{class:'seg',role:'group','aria-label':'Права ИИ для всех предметов'});['keep','move','replace','free'].forEach(p=>all.append(h('button',{type:'button',onclick:()=>{items.forEach(f=>pol.set(f.id,aiPolicy(f,p)));fill();refreshSoon();}},AI_NAME[p])));
    const fill=()=>{table.innerHTML='';
      const hd=h('div',{class:'hd'},h('span',{},`Предметы: ${items.length}`),h('span',{},'Всем: ',all));
      if(hasSavedPolicies())hd.append(h('button',{type:'button',class:'rst',onclick:()=>{items.forEach(f=>pol.set(f.id,aiPolicy(f,lockPolicy(f))));fill();refreshSoon();}},'Сбросить по замкам'));
      table.append(hd);
      items.forEach(f=>{const t=TYPE.get(f.typeId),fo=formOf(t,f.formId);table.append(h('div',{class:'airow'},h('img',{src:typeIcon(t),alt:'',width:'36',height:'36'}),h('div',{class:'nm'},f.name,h('small',{},(f.productId?'Товар':'Пустышка')+' · '+fo.dims.map(k=>fmt(f.dims[k])).join('×')+' '+UNITS[P.unit].l+(f.locked?' · заперт':''))),segFor(f)));});};
    fill(); box.append(table);
    const blk=h('div',{class:'roomblk'},h('h5',{},'Комната'));
    [['walls','Материалы стен'],['floor','Пол'],['ceiling','Потолок'],['lighting','Освещение и декор']].forEach(([k,nm])=>{const seg=h('div',{class:'seg',role:'group','aria-label':nm});[['keep','Как есть'],['ai','На усмотрение ИИ']].forEach(([v,l])=>seg.append(h('button',{type:'button',class:rm[k]===v?'on':'','aria-pressed':String(rm[k]===v),onclick:()=>{rm[k]=v;[...seg.children].forEach(x=>{const on=x.textContent===l;x.classList.toggle('on',on);x.setAttribute('aria-pressed',String(on));});refreshSoon();}},l)));
      blk.append(h('span',{},nm,k==='lighting'?h('small',{},' — учитывается на этапе рендера'):null),seg);});
    box.append(blk);
    const state=h('div',{class:'aistate','aria-live':'polite'}); box.append(state);
    const note=(kind,text)=>h('div',{class:kind==='err'?'pnote warn err':'pnote warn',role:kind==='err'?'alert':'status'},ic('alert'),h('div',{},text));
    /* Может ли ИИ‑дизайнер работать с таким планом: ошибки не дают продолжить, замечания — только предупреждают.
       Проверка пересчитывается с небольшой задержкой после нажатия: на большом плане она занимает доли секунды. */
    let blocked=false,timer=null;
    const refreshSoon=()=>{clearTimeout(timer);timer=setTimeout(refreshState,120);};
    function refreshState(){
      clearTimeout(timer);timer=null;state.innerHTML=''; blocked=false;
      if(aiNeeds(pol,rm)){
        const u=window.EditorSync&&EditorSync.user;
        if(!cfg.enabled){state.append(note('err',cfg.offline?'Нет связи с сервером — ИИ‑дизайнер сейчас недоступен.':'ИИ‑дизайнер пока не подключён на сервере.'));blocked=true;}
        else if(u&&u.emailVerified===false&&u.role!=='admin'&&EditorSync.mail){state.append(note('err','ИИ‑дизайнер доступен после подтверждения почты. Письмо со ссылкой — в вашем ящике; отправить его ещё раз можно в меню аккаунта.'));blocked=true;}
        const pre=aiPrecheck(pol,rm);
        pre.errors.forEach(e=>{state.append(note('err',e));blocked=true;});
        if(pre.empty.length)state.append(note('warn',`В каталоге нет подходящих товаров для: ${pre.empty.slice(0,6).map(f=>f.name).join(', ')}${pre.empty.length>6?` и ещё ${pre.empty.length-6}`:''}. ${pre.empty.length>1?'Эти предметы останутся':'Этот предмет останется'} как есть — ослабьте размеры, если нужен подбор.`));
      }
      if(api.primaryBtn)api.primaryBtn.disabled=blocked;
    }
    api.setup=refreshState;
    api.buttons=[{label:'Отмена',cancel:true,onClick:a=>{clearTimeout(timer);st.policies=pol;st.room=rm;a.close(null);}},{label:'Далее',primary:true,onClick:a=>{refreshState();if(blocked)return;a.close({policies:pol,room:rm});}}];
  });
}
const LIKES=[['style','Стиль в целом'],['colors','Цвета'],['furniture','Мебель'],['walls','Стены'],['floor','Пол'],['ceiling','Потолок'],['lighting','Освещение'],['decor','Декор'],['layout','Расположение']];
/* стили — те же, что в карточках товаров (словарь STYLES в shared/catalog-types.js) */
const PREFS={style:[...STYLES.map(s=>s[0].toUpperCase()+s.slice(1)),'Неважно'],palette:['Светлая','Тёмная','Тёплая','Холодная','Контрастная','Неважно'],budget:['Экономно','Средний','Премиум','Неважно']};
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
/* Отправка брифа. Есть что менять — запускается ИИ‑дизайнер (ai/run.js); нечего — расстановка сохраняется как итоговая.
   Экран результата — showResult() в ai/result.js. */
async function submitBrief(st){
  const policies={};(P.furniture||[]).forEach(f=>{policies[f.id]=aiPolicy(f,st.policies.get(f.id));});
  const briefItems=(P.furniture||[]).map(f=>({id:f.id,typeId:f.typeId,formId:f.formId,formAny:!!f.formAny,productId:f.productId,dims:f.dims,constraints:f.constraints,x:f.x,y:f.y,rot:f.rot,mirror:!!f.mirror,aiPolicy:policies[f.id]}));
  const brief={schemaVersion:3,createdAt:new Date().toISOString(),room:st.room,photos:st.photos,text:st.text||'',prefs:st.prefs,policies,items:briefItems};
  E.sel=null;
  if(aiNeeds(st.policies,st.room)){saveBriefDraft(st);await aiStart({mode:'new',brief});return;}
  const err=aiCommit(Q=>{Q.brief=brief;Q.briefDraft=null;Q.status='submitted';Q.showAiBadges=true;Q.ai=null;(Q.furniture||[]).forEach(f=>{f.aiPolicy=policies[f.id];});}); if(err){toast(err,true);return;}
  E.propsOpen=false;showResult();
}
function showBriefJson(){const json=JSON.stringify({room:{vertices:P.vertices,walls:P.walls,openings:P.openings,wallHeight:P.wallHeight,wallThickness:P.wallThickness,floor:P.floor},brief:P.brief},null,2);dialog((box,api)=>{box.classList.add('wide');box.append(h('h3',{},'Бриф для этапа 4'));const ta=h('textarea',{rows:'16',readonly:''});ta.value=json;box.append(ta);api.buttons=[{label:'Копировать',onClick:()=>{navigator.clipboard?.writeText(json).then(()=>toast('Скопировано'),()=>{ta.select();toast('Выделите и скопируйте вручную');});}},{label:'Закрыть',primary:true,cancel:true,onClick:a=>a.close(null)}];});}
function toggleMatPanel(){P.panelCollapsed=!P.panelCollapsed;save();$('#matPanel').classList.toggle('collapsed',P.panelCollapsed);}
