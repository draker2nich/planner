'use strict';
/* furnitech · редактор · order.js
   Путь к покупке: смета для печати и сохранения в PDF, заявка менеджеру, ссылка на проект для просмотра.
   Работает и с вариантами ИИ‑дизайнера (экран результата), и с обычной расстановкой (меню редактора).
   Корзины магазина у платформы нет — товар ведёт на страницу продавца, — поэтому «купить всё сразу» это заявка менеджеру.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
ICONS.printer='<path d="M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="6" rx="1"/>';
ICONS.link='<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>';
ICONS.send='<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>';

/* ---------- что считать заказом ---------- */
/* Клетка, с которой работаем: вариант ИИ‑дизайнера, исходная расстановка или то, что сейчас на плане (which == null).
   → {label, furniture, finishes} */
function orderCell(which){
  if(which!=null&&P.ai&&aiHasVariants()){const c=aiCellOf(P.ai,which);if(c&&!c.failed&&c.furniture)return {label:which==='base'?'Исходная расстановка':`Вариант ${which+1}: ${aiCellName(P.ai,which)}`,furniture:c.furniture,finishes:c.finishes||null};}
  return {label:'',furniture:P.furniture||[],finishes:aiFinishesOf(P)};
}
/* Строки заказа: одинаковые товары одной строкой, пустышки — в конце. → {rows:[{f,t,pr,n}], sums:Map(валюта→сумма), total:'…', products, missing} */
function orderRows(furniture){
  const map=new Map();
  for(const f of furniture||[]){const t=TYPE.get(f.typeId);if(!t)continue;const pr=f.productId?PRODUCT_BY_ID.get(f.productId)||null:null;const key=pr?pr.id:'ph:'+f.id;
    if(!map.has(key))map.set(key,{f,t,pr,n:0});map.get(key).n++;}
  const rows=[...map.values()].sort((a,b)=>(b.pr?1:0)-(a.pr?1:0));
  const sums=new Map();let products=0,missing=0;
  for(const r of rows){if(r.pr){products+=r.n;if(r.pr.price>0)sums.set(r.pr.currency||'RUB',(sums.get(r.pr.currency||'RUB')||0)+r.pr.price*r.n);}else missing+=r.n;}
  return {rows,sums,products,missing,total:[...sums.entries()].map(([c,v])=>fmtPrice(Math.round(v),c)).join(' + ')};
}
const orderDims=(r)=>{const fo=formOf(r.t,r.f.formId);return fo.dims.map(k=>fmt(r.f.dims[k])).join('×')+'×'+fmt(r.f.dims.H||0)+' '+UNITS[P.unit].l;};
function orderFinishText(m,def){const lib=m&&m.type==='texture'&&TEXLIB.find(t=>t.id===m.textureId);return lib?lib.name:m&&m.type==='photo'?'своё фото':'краска '+((m&&m.type==='color'&&m.color)||def);}

/* ---------- смета: печать и PDF ---------- */
/* Лист сметы собирается отдельным блоком страницы; при печати виден только он (правила @media print в editor.css).
   «Сохранить как PDF» — в диалоге печати браузера: так смета получается и на телефоне, и без сторонних библиотек. */
async function orderPrint(which){
  const cell=orderCell(which),o=orderRows(cell.furniture);
  if(!o.rows.length){toast('В расстановке пока нет предметов',true);return;}
  const old=document.getElementById('printSheet');if(old)old.remove();
  const now=new Date(),dateText=now.toLocaleDateString('ru',{day:'numeric',month:'long',year:'numeric'});
  const sheet=h('div',{id:'printSheet'});
  sheet.append(h('div',{class:'ps-head'},h('div',{class:'ps-brand'},'furni',h('span',{},'tech')),h('div',{class:'ps-meta'},'Смета от '+dateText)),
    h('h1',{},P.name||'Проект'));
  if(cell.label)sheet.append(h('p',{class:'ps-sub'},cell.label));
  /* план: тот же рисунок, что на карточке варианта, в светлых цветах для бумаги */
  const cv2=document.createElement('canvas');
  try{aiMiniPlan(cv2,{furniture:cell.furniture,finishes:cell.finishes||{}},null,{w:640,h:360});sheet.append(h('img',{class:'ps-plan',alt:'План комнаты',src:cv2.toDataURL('image/png')}));}catch(e){}
  const area=D&&D.area?m2(Math.abs(D.area)):'';
  const fin=cell.finishes||{walls:{}};const wallIds=Object.keys(fin.walls||{});
  sheet.append(h('p',{class:'ps-room'},[area&&'Площадь '+area,'высота потолка '+fmtU(P.wallHeight),'стены — '+orderFinishText(wallIds.length?fin.walls[wallIds[0]]:null,WALL_DEF),'пол — '+orderFinishText(fin.floor,FLOOR_DEF),'потолок — '+orderFinishText(fin.ceiling,CEIL_DEF)].filter(Boolean).join(' · ')));
  const tb=h('tbody',{});let i=0;
  for(const r of o.rows){i++;const pr=r.pr;const img=h('img',{alt:'',width:'48',height:'48'});img.src=pr?productThumb(pr):typeIcon(r.t);
    const name=h('td',{class:'ps-nm'},h('b',{},pr?pr.name:'Пустышка: '+r.f.name),h('div',{},r.t.name+' · '+orderDims(r)+(pr&&pr.brand?' · '+pr.brand:'')));
    if(pr&&pr.url&&/^https?:\/\//.test(pr.url))name.append(h('a',{href:pr.url},pr.url));
    tb.append(h('tr',{class:pr?'':'ps-ph'},h('td',{class:'ps-n'},String(i)),h('td',{class:'ps-img'},img),name,h('td',{class:'ps-q'},String(r.n)),
      h('td',{class:'ps-p'},pr?(pr.price>0?fmtPrice(pr.price,pr.currency):'—'):'товар не выбран'),h('td',{class:'ps-p'},pr&&pr.price>0?fmtPrice(pr.price*r.n,pr.currency):'')));}
  sheet.append(h('table',{class:'ps-table'},h('thead',{},h('tr',{},h('th',{},'№'),h('th',{}),h('th',{},'Наименование'),h('th',{class:'ps-q'},'Кол‑во'),h('th',{class:'ps-p'},'Цена'),h('th',{class:'ps-p'},'Сумма'))),tb));
  sheet.append(h('div',{class:'ps-total'},h('span',{},`Товаров: ${o.products}`+(o.missing?` · без товара: ${o.missing}`:'')),h('b',{},o.total?'Итого: '+o.total:'Цены не указаны')));
  sheet.append(h('p',{class:'ps-foot'},'Цены и наличие — на '+dateText+'; уточняйте у продавца. Размеры на плане — в '+UNITS[P.unit].l+'.'));
  document.body.append(sheet);
  /* картинки товаров должны успеть загрузиться, иначе в PDF будут пустые клетки */
  await Promise.race([Promise.all([...sheet.querySelectorAll('img')].map(im=>im.decode?im.decode().catch(()=>{}):Promise.resolve())),new Promise(r=>setTimeout(r,2500))]);
  const title=document.title;document.title='Смета — '+(P.name||'проект');
  const done=()=>{document.title=title;sheet.remove();window.removeEventListener('afterprint',done);};
  window.addEventListener('afterprint',done);
  try{window.print();}catch(e){done();toast('Печать недоступна в этом браузере',true);}
}

/* ---------- заявка менеджеру ---------- */
async function orderLead(which){
  if(READONLY){toast(READONLY_MSG);return;}
  const S0=window.EditorSync||{};
  if(S0.mode!=='account'||!S0.id){toast('Проект ещё не сохранён в аккаунт. Проверьте связь и попробуйте снова',true);return;}
  const cell=orderCell(which),o=orderRows(cell.furniture);
  if(!o.products){toast('В расстановке нет товаров: выберите товары вместо пустышек или запустите подбор с ИИ',true);return;}
  const sent=await dialog((box,api)=>{
    box.classList.add('mid');
    box.append(h('h3',{},'Заявка менеджеру'),h('div',{class:'hint'},'Менеджер получит список товаров и свяжется с вами: уточнит наличие, доставку и оформит заказ.'));
    box.append(h('div',{class:'summary'},cell.label?h('span',{},cell.label):null,h('span',{},'Товаров: ',h('b',{},String(o.products))),o.total?h('span',{},'На сумму: ',h('b',{},o.total)):null));
    if(o.missing)box.append(h('div',{class:'pnote',role:'status'},ic('info'),h('div',{},`Пустышки без товара (${o.missing}) в заявку не войдут.`)));
    const fld=(label,el,id)=>{el.id=id;const er=h('div',{class:'err',style:'min-height:0;margin:2px 0 0'});return {row:h('div',{class:'ofld'},h('label',{for:id},label),el,er),el,er};};
    const name=fld('Как к вам обращаться',h('input',{type:'text',autocomplete:'name',maxlength:'80',value:(S0.user&&S0.user.name)||''}),'leadName');
    const phone=fld('Телефон',h('input',{type:'tel',autocomplete:'tel',inputmode:'tel',maxlength:'32',placeholder:'+375 29 123‑45‑67'}),'leadPhone');
    const cm=fld('Комментарий (необязательно)',h('textarea',{rows:'3',maxlength:'600',placeholder:'Удобное время для звонка, вопросы по доставке и сборке…'}),'leadComment');
    box.append(name.row,phone.row,cm.row,h('div',{class:'hint',style:'margin-top:8px'},'Вместе с заявкой менеджер увидит почту вашего аккаунта'+(S0.user&&S0.user.email?' ('+S0.user.email+')':'')+'.'));
    let busy=false;
    api.buttons=[{label:'Отмена',cancel:true,onClick:a=>{if(!busy)a.close(null);}},{label:'Отправить заявку',primary:true,onClick:async a=>{
      if(busy)return;[name,phone,cm].forEach(f=>{f.er.textContent='';f.el.classList.remove('bad');});a.err('');
      const items=o.rows.filter(r=>r.pr).map(r=>({productId:r.pr.id,qty:r.n}));
      busy=true;a.primaryBtn.disabled=true;a.primaryBtn.textContent='Отправляем…';
      try{const r=await Session.api('POST','/projects/'+S0.id+'/lead',{name:name.el.value,phone:phone.el.value,comment:cm.el.value,variant:cell.label,items});a.close(r);}
      catch(e){busy=false;a.primaryBtn.disabled=false;a.primaryBtn.textContent='Отправить заявку';
        const f=e.details&&e.details.fields;const map={name,phone};let shown=false;
        if(f)for(const k in f)if(map[k]){map[k].er.textContent=f[k];map[k].el.classList.add('bad');if(!shown){map[k].el.focus();shown=true;}}
        if(!shown)a.err(e.message||'Не удалось отправить заявку');}
    }}];
  });
  if(sent)toast('Заявка отправлена. Менеджер свяжется с вами');
}

/* ---------- ссылка на проект ---------- */
async function orderShare(){
  if(READONLY){toast(READONLY_MSG);return;}
  const S0=window.EditorSync||{};
  if(S0.mode!=='account'||!S0.id){toast('Проект ещё не сохранён в аккаунт. Проверьте связь и попробуйте снова',true);return;}
  let r;try{r=await Session.api('POST','/projects/'+S0.id+'/share');}catch(e){toast(e.message||'Не удалось создать ссылку',true);return;}
  const url=location.origin+'/editor?share='+r.token;
  await dialog((box,api)=>{
    box.classList.add('mid');
    box.append(h('h3',{},'Ссылка на проект'),h('div',{class:'hint'},'Кто откроет ссылку, увидит план, мебель, 3D и варианты ИИ‑дизайнера — без входа и только для просмотра. Ваши пожелания, фото‑референсы и почта по ссылке не показываются.'));
    const inp=h('input',{type:'text',readonly:'',value:url,'aria-label':'Ссылка на проект',spellcheck:'false'});inp.onfocus=()=>inp.select();
    const copy=async()=>{try{await navigator.clipboard.writeText(url);toast('Ссылка скопирована');}catch(e){inp.focus();inp.select();toast('Выделите ссылку и скопируйте вручную');}};
    box.append(h('div',{class:'sharerow'},inp,h('button',{type:'button',onclick:copy},ic('copy'),'Копировать')));
    const btns=[{label:'Отключить ссылку',onClick:async a=>{if(!(await orderShareOff(S0.id)))return;a.close(null);}},{label:'Готово',primary:true,cancel:true,onClick:a=>a.close(null)}];
    if(navigator.share)btns.splice(1,0,{label:'Отправить…',onClick:()=>{navigator.share({title:P.name||'Проект комнаты',url}).catch(()=>{});}});
    api.buttons=btns;
  });
}
async function orderShareOff(id){
  try{await Session.api('DELETE','/projects/'+id+'/share');toast('Ссылка отключена — по старому адресу проект больше не открывается');return true;}
  catch(e){toast(e.message||'Не удалось отключить ссылку',true);return false;}
}

/* ---------- блок «Что дальше» на экране результата ---------- */
/* cells — какие расстановки можно выбрать: [0, 1, 'base'] у вариантов ИИ или [null] для обычного проекта */
let ORDER_PICK;
function orderBlock(cells){
  const usable=cells.filter(c=>{const k=orderCell(c);return k.furniture&&k.furniture.length&&(c==null||!(aiCellOf(P.ai,c)||{}).failed);});
  if(!usable.length)return null;
  const pref=P.ai&&P.ai.chosen!=null&&usable.includes(P.ai.chosen)?P.ai.chosen:usable[0];
  if(ORDER_PICK===undefined||!usable.includes(ORDER_PICK)||(P.ai&&P.ai.chosen!=null&&usable.includes(P.ai.chosen)))ORDER_PICK=pref;
  const box=h('div',{class:'card orderblk'});
  const fill=()=>{box.innerHTML='';const o=orderRows(orderCell(ORDER_PICK).furniture);
    box.append(h('h4',{},'Что дальше'),h('p',{class:'note'},READONLY?'Сохраните смету со списком товаров и ценами.':'Отправьте список товаров менеджеру, сохраните смету или покажите проект близким.'));
    if(usable.length>1){const seg=h('div',{class:'seg',role:'group','aria-label':'Какая расстановка'});
      usable.forEach(c=>seg.append(h('button',{type:'button',class:c===ORDER_PICK?'on':'','aria-pressed':String(c===ORDER_PICK),onclick:()=>{ORDER_PICK=c;fill();}},c==='base'?'Исходная':`Вариант ${c+1}`)));box.append(seg);}
    box.append(h('div',{class:'summary'},h('span',{},'Товаров: ',h('b',{},String(o.products))),o.missing?h('span',{},'Без товара: ',h('b',{},String(o.missing))):null,o.total?h('span',{},'Сумма: ',h('b',{},o.total)):null));
    const acts=h('div',{class:'orderacts'});
    if(!READONLY){const lb=h('button',{type:'button',class:'primary',onclick:()=>orderLead(ORDER_PICK)},ic('send'),'Отправить заявку менеджеру');if(!o.products){lb.disabled=true;lb.title='В расстановке нет товаров';}acts.append(lb);}
    acts.append(h('button',{type:'button',class:READONLY?'primary':'',onclick:()=>orderPrint(ORDER_PICK)},ic('printer'),'Смета · PDF'));
    if(!READONLY)acts.append(h('button',{type:'button',onclick:orderShare},ic('link'),'Поделиться ссылкой'));
    box.append(acts);};
  fill();return box;
}
/* Пункты основного меню редактора (вызывается из buildMenu): то же самое для расстановки, которая сейчас на плане */
function orderMenuItems(menu){
  if(!P.closed||!(P.furniture||[]).length||T3.active)return;
  const mi=(icon,label,fn)=>h('button',{type:'button',class:'mi',role:'menuitem',onclick:()=>{menu.hidden=true;fn();}},ic(icon),label);
  menu.append(mi('printer','Смета · PDF',()=>orderPrint(null)));
  if(!READONLY)menu.append(mi('send','Заявка менеджеру',()=>orderLead(null)),mi('link','Поделиться ссылкой',orderShare));
  menu.append(h('hr'));
}
