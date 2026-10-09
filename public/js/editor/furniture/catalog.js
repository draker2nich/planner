'use strict';
/* furnitech · редактор · furniture/catalog.js
   Панель каталога, диалоги размеров и выбора товара.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ---------- Каталог: панель ---------- */
function typeIcon(t){if(t._icon)return t._icon;const c=document.createElement('canvas');c.width=c.height=56;const x=c.getContext('2d');const fo=t.forms[0];const l=fpPoly(fo.fp,fo.typical);const k=44/Math.max(l.w,l.h);x.translate(28,28);x.scale(k,k);x.lineWidth=1.2/k;x.strokeStyle=cssv('--fg')||'#222';x.beginPath();l.pts.forEach((p,i)=>i?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));x.closePath();x.stroke();x.lineWidth=0.9/k;(SYM[t.symbol]||SYM.generic)(x,l,fo.typical,fo);t._icon=c.toDataURL();return t._icon;}
/* Поиск товаров по названию и бренду. Регистр и «ё/е» не важны; запрос из нескольких слов — должны найтись все. → {list, total} */
const searchNorm=(v)=>String(v||'').toLowerCase().replace(/ё/g,'е');
function searchProducts(query,limit,pool){
  const words=searchNorm(query).split(/\s+/).filter(Boolean);if(!words.length)return {list:[],total:0};
  const out=[];let total=0;
  for(const pr of pool||PRODUCTS){if(!TYPE.get(pr.typeId))continue;const hay=pr._hay||(pr._hay=searchNorm(pr.name+' '+(pr.brand||'')));
    if(words.every(w=>hay.includes(w))){total++;if(out.length<limit)out.push(pr);}}
  return {list:out,total};
}
function buildCatalog(){
  const cat=$('#catalog'); cat.innerHTML=''; const q=(E.catQuery||'').toLowerCase();
  const search=h('input',{type:'search',placeholder:'Тип, товар или бренд…',value:E.catQuery||'','aria-label':'Поиск по каталогу',autocomplete:'off',spellcheck:'false'}); search.oninput=()=>{E.catQuery=search.value;buildCatalog();const s=$('#catalog input[type=search]');s.focus();s.setSelectionRange(s.value.length,s.value.length);};
  cat.append(h('div',{class:'chead'},h('h4',{},'Каталог'),E.catQuery?h('button',{type:'button',class:'x','aria-label':'Сбросить поиск',title:'Сбросить поиск',onclick:()=>{E.catQuery='';buildCatalog();}},ic('close')):null,h('button',{type:'button',class:'x closeSheet','aria-label':'Закрыть каталог',onclick:()=>setCatalogOpen(false)},ic('chevron-down'))),h('div',{class:'csearch'},ic('search'),search));
  const clist=h('div',{class:'clist'}); cat.append(clist);
  if(E.recentTypes?.length&&!q){clist.append(h('div',{class:'ccat open'},h('div',{class:'ct',style:'cursor:default;text-decoration:none'},'Недавние'),h('div',{class:'tiles'},...E.recentTypes.map(id=>tile(TYPE.get(id))))));}
  for(const [cid,cname] of CATS){const types=TYPES.filter(t=>t.cats.includes(cid)&&(!q||t.name.toLowerCase().includes(q)));if(!types.length)continue;const open=!!q||E.catOpen===cid;const el=h('div',{class:'ccat'+(open?' open':'')});const head=h('button',{type:'button',class:'ct','aria-expanded':String(open),onclick:()=>{E.catOpen=E.catOpen===cid?null:cid;buildCatalog();}},cname,h('span',{},String(types.length),ic('chevron-right','chev')));el.append(head);if(open)el.append(h('div',{class:'tiles'},...types.map(tile)));clist.append(el);}
  /* поиск по названию и бренду товара: совпадают все слова запроса; товар ставится на план сразу, минуя выбор размеров */
  if(q.trim().length>=2){
    const hits=searchProducts(q,24);
    if(hits.list.length){
      const box=h('div',{class:'ccat open cprod'},h('div',{class:'ct',style:'cursor:default;text-decoration:none'},'Товары',h('span',{},hits.total>hits.list.length?`${hits.list.length} из ${hits.total}`:String(hits.total))));
      const ul=h('div',{class:'plist'});
      for(const pr of hits.list){const t=TYPE.get(pr.typeId);
        ul.append(h('button',{type:'button',class:'prow',title:pr.name,onclick:()=>{setCatalogOpen(false);E.recentTypes=[t.id,...(E.recentTypes||[]).filter(x=>x!==t.id)].slice(0,8);beginPlace(makeFurniture(t,pr.formId,{},pr));}},
          h('img',{src:productThumb(pr),class:pr.images&&pr.images.length?'':'gen',alt:'',width:'40',height:'40',loading:'lazy'}),
          h('span',{class:'pn'},h('b',{},pr.name),h('small',{},t.name+(pr.brand?' · '+pr.brand:''))),
          h('span',{class:'pp'},pr.price?fmtPrice(pr.price,pr.currency):'')));}
      box.append(ul);clist.append(box);
    }
    if(!clist.children.length)clist.append(h('div',{class:'hint',style:'padding:12px 4px'},'Ничего не найдено. Попробуйте название типа («диван»), товара или бренда.'));
  }
  updateTools();
  function tile(t){const has=(P.furniture||[]).some(f=>f.typeId===t.id&&!f.productId);const el=h('button',{type:'button',class:'tile',title:t.name,onclick:()=>{setCatalogOpen(false);startFurniture(t);}});el.append(h('img',{src:typeIcon(t),alt:'',width:'44',height:'44'}),h('span',{},t.name));if(has)el.append(h('i',{class:'dot'}));return el;}
}

/* ---------- Диалог размеров ---------- */
function typicalDims(fo,cons){const d={};for(const k of [...fo.dims,'H']){const c=cons[k]||{mode:'any'};if(c.mode==='exact')d[k]=c.exact;else if(c.mode==='range'){const lo=c.min??null,hi=c.max??null;const typ=fo.typical[k]||500;d[k]=(lo!=null&&hi!=null)?Math.round((lo+hi)/2):(lo!=null?Math.max(lo,typ):Math.min(hi,typ));}else d[k]=fo.typical[k]||500;}if(fo.typical.E!=null)d.E=fo.typical.E;return d;}
/* matchProduct — в общем модуле public/shared/catalog-types.js: тем же правилом сервер отбирает кандидатов для ИИ‑дизайнера */
function countProducts(t,formId,cons){return PRODUCTS.filter(pr=>pr.typeId===t.id&&(formId==='any'||pr.formId===formId)&&matchProduct(pr,formOf(t,pr.formId),cons)).length;}
async function sizeDialog(t,init){
  return dialog((box,api)=>{
    box.classList.add('mid'); box.append(h('h3',{},t.name));
    let formId=init?.formId||t.defaultFormId||t.forms[0].id; let cons=init?.cons?JSON.parse(JSON.stringify(init.cons)):{};
    const fo=()=>formOf(t,formId==='any'?(t.forms[0].id):formId);
    const U=unitRow(); box.append(U.row);
    let fsel=null; if(t.forms.length>1){fsel=h('div',{class:'seg'});box.append(h('div',{class:'f'},h('label',{},'Форма'),fsel));}
    const rows=h('div',{}); box.append(rows); const cnt=h('div',{class:'hint'}); box.append(cnt);
    const fields={};
    const upd=()=>{const n=countProducts(t,formId,cons);cnt.textContent=`Подходит товаров: ${n}`;if(api.showBtn)api.showBtn.disabled=n===0;};
    const buildRows=()=>{rows.innerHTML='';fields.k={};const f=fo();const keys=[...f.dims];
      if(f.fp==='L'||f.fp==='U'){rows.append(h('div',{class:'hint'},'A — длина по основной стороне, B — длина углового модуля, D — глубина посадки. Сторона угла задаётся зеркалом (M) после установки.'));}
      const mk=(k)=>{const c=cons[k]=cons[k]||{mode:'any'};const seg=h('div',{class:'seg'});const ex=h('input',{type:'text',placeholder:'точно',inputmode:'decimal'}),mn=h('input',{type:'text',placeholder:'мин',inputmode:'decimal'}),mx=h('input',{type:'text',placeholder:'макс',inputmode:'decimal'});
        const setMode=(m)=>{c.mode=m;[...seg.children].forEach(b=>b.classList.toggle('on',b.dataset.m===m));ex.hidden=m!=='exact';mn.hidden=mx.hidden=m!=='range';if(m==='any'){delete c.exact;delete c.min;delete c.max;ex.value=mn.value=mx.value='';}upd();};
        ['any','exact','range'].forEach(m=>seg.append(h('button',{type:'button','data-m':m,onclick:()=>setMode(m)},{any:'Неважно',exact:'Точно',range:'Диапазон'}[m])));
        ex.oninput=()=>{const v=parseLen(ex.value);if(c.mode!=='exact'){c.mode='exact';[...seg.children].forEach(b=>b.classList.toggle('on',b.dataset.m==='exact'));}delete c.min;delete c.max;mn.value=mx.value='';c.exact=isNaN(v)?undefined:v;upd();};
        const rng=()=>{if(c.mode!=='range'){c.mode='range';[...seg.children].forEach(b=>b.classList.toggle('on',b.dataset.m==='range'));}delete c.exact;ex.value='';const a=parseLen(mn.value),b=parseLen(mx.value);c.min=isNaN(a)?undefined:a;c.max=isNaN(b)?undefined:b;upd();};mn.oninput=rng;mx.oninput=rng;
        if(c.mode==='exact'&&c.exact!=null)ex.value=fmt(c.exact);if(c.mode==='range'){if(c.min!=null)mn.value=fmt(c.min);if(c.max!=null)mx.value=fmt(c.max);}
        const row=h('div',{class:'drow'},h('div',{class:'dl'},h('b',{},k==='DIA'?'Ø':k),' ',DIMN[k]),seg,h('div',{class:'dv'},ex,mn,mx,h('span',{},UNITS[P.unit].l)));fields.k[k]={ex,mn,mx};setMode(c.mode);return row;};
      keys.forEach(k=>rows.append(mk(k)));
      const more=h('details',{},h('summary',{},'Ещё'),mk('H'));rows.append(more);};
    if(fsel){const opts=[...t.forms.map(f=>[f.id,f.name]),['any','Неважно']];opts.forEach(([id,nm])=>fsel.append(h('button',{type:'button','data-f':id,class:id===formId?'on':'',onclick:()=>{formId=id;[...fsel.children].forEach(b=>b.classList.toggle('on',b.dataset.f===id));cons={};buildRows();upd();}},nm)));}
    U.sel.onchange=()=>{P.unit=U.sel.value;$('#unitSel').value=P.unit;buildRows();render();};
    buildRows(); api.setup=upd;
    const validate=()=>{const f=fo();for(const k of [...f.dims,'H']){const c=cons[k];if(!c||c.mode==='any')continue;if(c.mode==='exact'){if(c.exact==null)return `${DIMN[k]}: введите точное значение или выберите «Неважно»`;if(c.exact<DIMLIM.min||c.exact>DIMLIM.max)return `${DIMN[k]}: ${fmtU(DIMLIM.min)} … ${fmtU(DIMLIM.max)}`;}if(c.mode==='range'){if(c.min==null&&c.max==null)return `${DIMN[k]}: введите мин или макс`;if(c.min!=null&&c.max!=null&&c.min>c.max)return `${DIMN[k]}: мин больше макс`;}}return null;};
    api.buttons=[{label:'Отмена',cancel:true,onClick:a=>a.close(null)},{label:'Поставить пустышку',onClick:a=>{const e=validate();if(e)return a.err(e);const fid=formId==='any'?(t.defaultFormId||t.forms[0].id):formId;a.close({formId:fid,formAny:formId==='any',cons,placeholder:true});}},{label:'Показать товары',primary:true,onClick:a=>{const e=validate();if(e)return a.err(e);a.close({formId,cons,placeholder:false});}}];
    api.setup=()=>{api.showBtn=api.primaryBtn;upd();};
  });
}
const CUR_SIGN={RUB:'₽',USD:'$',EUR:'€'};
function fmtPrice(v,c){c=c||PLATFORM_CURRENCY;return v.toLocaleString('ru')+' '+(CUR_SIGN[c]||c);}
function productThumb(pr){if(pr.images&&pr.images.length)return pr.images[0].url;if(pr._thumb)return pr._thumb;const t=TYPE.get(pr.typeId),fo=formOf(t,pr.formId);const c=document.createElement('canvas');c.width=c.height=96;const x=c.getContext('2d');const l=fpPoly(fo.fp,pr.dims);const k=80/Math.max(l.w,l.h);x.translate(48,48);x.scale(k,k);x.lineWidth=1.2/k;x.strokeStyle='#333';x.fillStyle='rgba(31,95,191,.08)';x.beginPath();l.pts.forEach((p,i)=>i?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));x.closePath();x.fill();x.stroke();x.lineWidth=0.9/k;(SYM[t.symbol]||SYM.generic)(x,l,pr.dims,fo);pr._thumb=c.toDataURL();return pr._thumb;}
async function productDialog(t,formId,cons,opts={}){
  return dialog((box,api)=>{
    box.classList.add('wide'); box.append(h('h3',{},t.name+' — товары'));
    let sort='rel',fid=formId; const fo=()=>formOf(t,fid==='any'?t.forms[0].id:fid);
    const tools=h('div',{class:'row'}); const fs=h('select',{},h('option',{value:'any'},'Все формы'),...t.forms.map(f=>h('option',{value:f.id},f.name)));fs.value=fid;fs.onchange=()=>{fid=fs.value;fill();};
    const ss=h('select',{},h('option',{value:'rel'},'По релевантности'),h('option',{value:'price'},'По цене'),h('option',{value:'size'},'По размеру'));ss.onchange=()=>{sort=ss.value;fill();};
    tools.append(fs,ss); box.append(tools);
    /* фильтры: название или бренд, цена, цвет, стиль, наличие 3D‑модели. В списках цвета и стиля — только значения, которые есть у товаров этого типа. */
    const F={q:'',min:null,max:null,color:'',style:'',m3d:false};
    const ofType=PRODUCTS.filter(pr=>pr.typeId===t.id);
    const present=(key)=>{const c=new Map();for(const pr of ofType)for(const v of pr[key]||[])c.set(v,(c.get(v)||0)+1);return [...c.entries()].sort((a,b)=>b[1]-a[1]);};
    const fq=h('input',{type:'search',placeholder:'Название или бренд…','aria-label':'Поиск по названию или бренду',autocomplete:'off',spellcheck:'false'});
    const pmin=h('input',{type:'text',inputmode:'numeric',placeholder:'Цена от','aria-label':'Цена от'}),pmax=h('input',{type:'text',inputmode:'numeric',placeholder:'до','aria-label':'Цена до'});
    const colors=present('colors'),styles=present('styleTags');
    const fc=h('select',{'aria-label':'Цвет'},h('option',{value:''},'Любой цвет'),...colors.map(([v,n])=>h('option',{value:v},`${v} (${n})`)));
    const fst=h('select',{'aria-label':'Стиль'},h('option',{value:''},'Любой стиль'),...styles.map(([v,n])=>h('option',{value:v},`${v} (${n})`)));
    const f3=h('input',{type:'checkbox',id:'pf3d'});
    const num=(el)=>{const v=parseFloat(String(el.value).replace(/\s/g,'').replace(',','.'));return isFinite(v)&&v>=0?v:null;};
    let ft;const later=()=>{clearTimeout(ft);ft=setTimeout(()=>{F.q=fq.value;F.min=num(pmin);F.max=num(pmax);fill();},180);};
    fq.oninput=later;pmin.oninput=later;pmax.oninput=later;fc.onchange=()=>{F.color=fc.value;fill();};fst.onchange=()=>{F.style=fst.value;fill();};f3.onchange=()=>{F.m3d=f3.checked;fill();};
    const frow=h('div',{class:'pfilters'},h('div',{class:'pf-q'},ic('search'),fq),h('div',{class:'pf-price'},pmin,pmax));
    if(colors.length>1)frow.append(fc);if(styles.length>1)frow.append(fst);
    if(ofType.some(pr=>pr.model)&&ofType.some(pr=>!pr.model))frow.append(h('label',{class:'chk',for:'pf3d'},f3,h('span',{},'Только с 3D')));
    const fcount=h('div',{class:'hint pf-count',role:'status'});
    box.append(frow,fcount);
    const grid=h('div',{class:'pgrid'}); box.append(grid);
    const target=(k)=>{const c=cons[k];if(!c||c.mode==='any')return null;if(c.mode==='exact')return c.exact;if(c.min!=null&&c.max!=null)return (c.min+c.max)/2;return c.min??c.max;};
    const fill=()=>{grid.innerHTML='';
      if(!opts.noPlaceholder){const ph=h('button',{type:'button',class:'pt ph',onclick:()=>api.close({placeholder:true,formId:fid==='any'?(t.defaultFormId||t.forms[0].id):fid})},h('div',{class:'q'},'?'),h('b',{},'Пустышка'),h('span',{},'выбрать потом'));grid.append(ph);}
      let list=PRODUCTS.filter(pr=>pr.typeId===t.id&&(fid==='any'||pr.formId===fid)&&matchProduct(pr,formOf(t,pr.formId),cons));
      const bySize=list.length;
      if(F.q.trim())list=searchProducts(F.q,Infinity,list).list;
      if(F.min!=null)list=list.filter(pr=>pr.price>=F.min);
      if(F.max!=null)list=list.filter(pr=>pr.price>0&&pr.price<=F.max);
      if(F.color)list=list.filter(pr=>(pr.colors||[]).includes(F.color));
      if(F.style)list=list.filter(pr=>(pr.styleTags||[]).includes(F.style));
      if(F.m3d)list=list.filter(pr=>pr.model);
      const filtered=!!(F.q.trim()||F.min!=null||F.max!=null||F.color||F.style||F.m3d);
      fcount.textContent=filtered?`Найдено: ${list.length} из ${bySize}`:`Товаров: ${bySize}`;
      const rel=(pr)=>{let s=0;for(const k in pr.dims){const tg=target(k);if(tg!=null)s+=Math.abs(pr.dims[k]-tg);}return s;};
      list.sort((a,b)=>sort==='price'?(a.price-b.price):sort==='size'?(Object.values(a.dims).reduce((x,y)=>x+y,0)-Object.values(b.dims).reduce((x,y)=>x+y,0)):(rel(a)-rel(b)));
      /* товаров одного типа может быть тысяча и больше — плитки добавляются порциями */
      const PAGE=120;let shown=0;const more=h('button',{type:'button',class:'pt ph',onclick:()=>addPage()},h('div',{class:'q'},'…'),h('b',{},'Показать ещё'),h('span',{}));
      const addTile=pr=>{const f=formOf(t,pr.formId);const dims=f.dims.map(k=>fmt(pr.dims[k])).join('×')+'×'+fmt(pr.dims.H);grid.append(h('button',{type:'button',class:'pt',onclick:()=>api.close({product:pr})},h('img',{src:productThumb(pr),class:pr.images&&pr.images.length?'':'gen',alt:'',width:'88',height:'88',loading:'lazy'}),h('b',{},pr.name),h('span',{},dims+' '+UNITS[P.unit].l),h('span',{},pr.price?fmtPrice(pr.price,pr.currency):''),h('i',{},f.name+(pr.model?' · 3D':''))));};
      const addPage=()=>{more.remove();list.slice(shown,shown+PAGE).forEach(addTile);shown=Math.min(list.length,shown+PAGE);if(shown<list.length){more.lastChild.textContent=`осталось ${list.length-shown}`;grid.append(more);}};
      addPage();
      if(!list.length)grid.append(h('div',{class:'hint'},filtered&&bySize?'Под фильтры ничего не подходит — снимите часть из них':'Ничего не подходит — ослабьте ограничения по размерам'));};
    fill();
    api.buttons=[{label:'← Изменить размеры',onClick:a=>a.close({back:true})},{label:'Отмена',cancel:true,onClick:a=>a.close(null)}];
  });
}
async function startFurniture(t,init){
  if(P.mode!=='furniture')return; E.recentTypes=[t.id,...(E.recentTypes||[]).filter(x=>x!==t.id)].slice(0,8);
  let r=await sizeDialog(t,init); if(!r)return;
  while(!r.placeholder){const pr=await productDialog(t,r.formId,r.cons);if(!pr){return;}if(pr.back){r=await sizeDialog(t,{formId:r.formId,cons:r.cons});if(!r)return;continue;}if(pr.placeholder){r={formId:pr.formId,cons:r.cons,placeholder:true,formAny:r.formId==='any'};break;}
    beginPlace(makeFurniture(t,pr.product.formId,r.cons,pr.product));return;} // форма — та, что у товара: круглый стол не должен встать прямоугольным
  beginPlace(makeFurniture(t,r.formId,r.cons,null,r.formAny));
}
function makeFurniture(t,formId,cons,product,formAny){const fo=formOf(t,formId);const dims=product?Object.assign({},product.dims):typicalDims(fo,cons);P.fseq=P.fseq||{};const name=product?product.name:`${t.name} ${(P.fseq[t.id]||0)+1}`;return {id:uid(),typeId:t.id,formId,productId:product?product.id:null,formAny:!product&&!!formAny,name,constraints:cons,dims,x:0,y:0,rot:0,mirror:false,locked:false,warnings:[]};}
function beginPlace(item){E.fPlace=item;E.fRot=0;E.fMirror=false;E.mode='fPlace';E.sel=null;E.fGhost=null;updateTools();render();}
