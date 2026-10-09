'use strict';
/* furnitech · редактор · shell.js
   Иконки, уведомления, шапка и меню, нижняя панель, подсказки, компактный виджет, бейджи прав ИИ.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* =====================================================================
   Правки UI, дизайн‑система, Этап 3 — иконки, шапка, панель свойств, бриф
   ===================================================================== */
const ICONS={
 'menu-dots':'<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
 lock:'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
 'lock-open':'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
 cursor:'<path d="M5 3l14 8-6 2-3 6z"/>', wall:'<path d="M4 20V6h16v14M4 13h16M12 6v7M8 13v7M16 13v7"/>',
 door:'<path d="M3 20h18M7 20V5M7 5a12 12 0 0 1 10 10"/>', window:'<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 12h18M12 5v14"/>',
 arch:'<path d="M4 20V11a8 8 0 0 1 16 0v9"/>', eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
 ruler:'<path d="M3 8h18M3 6v4M21 6v4M8 18h8M8 16v4M16 16v4"/>', maximize:'<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
 undo:'<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>', redo:'<path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"/>',
 trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', 'chevron-left':'<path d="M15 6l-6 6 6 6"/>', 'chevron-right':'<path d="M9 6l6 6-6 6"/>',
 close:'<path d="M6 6l12 12M18 6L6 18"/>', alert:'<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17v1"/>', info:'<circle cx="12" cy="12" r="9"/><path d="M12 8v1M12 11v5"/>',
 check:'<path d="M5 12l5 5 9-11"/>', image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
 upload:'<path d="M12 16V4M6 10l6-6 6 6M4 20h16"/>', sparkles:'<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.8 2.2 2.2.8-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/>',
 'arrow-up':'<path d="M12 19V5M5 12l7-7 7 7"/>', search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 'chevron-down':'<path d="M6 9l6 6 6-6"/>', layers:'<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5M3 17l9 5 9-5"/>', settings:'<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z"/>',
 copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', sofa:'<path d="M4 18v-6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6M4 18h16M4 18v2M20 18v2M6 10V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3"/>',
 lightbulb:'<path d="M9 18h6M10 21h4M8 13a5 5 0 1 1 8 0c-1 1-1 2-1 3H9c0-1 0-2-1-3z"/>', move:'<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>', replace:'<path d="M4 7h11l-3-3M20 17H9l3 3"/>'
};
function ic(name,cls){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('class','ic'+(cls?' '+cls:''));s.setAttribute('aria-hidden','true');s.innerHTML=ICONS[name]||ICONS.info;return s;}
function setIcon(el,name){el.querySelectorAll('svg').forEach(x=>x.remove());el.prepend(ic(name));}
function lockIcon(locked){return ic(locked?'lock':'lock-open');}
/* toast с иконкой (переопределение) */
function toast(msg,err=false){const box=$('#toasts');while(box.children.length>=3)box.firstElementChild.remove();const t=document.createElement('div');t.className='toast'+(err?' err':'');t.setAttribute('role',err?'alert':'status');t.append(ic(err?'alert':'info'),h('span',{},msg));box.appendChild(t);/* время показа зависит от длины: длинную подсказку за 2,5 секунды не прочитать */setTimeout(()=>t.remove(),Math.min(9000,(err?3500:2500)+Math.max(0,String(msg).length-40)*45));}

/* ---------- Шапка ---------- */
function initHeader(){
  const menu=$('#menu'),mb=$('#menuBtn');
  const setMenu=(open)=>{menu.hidden=!open;mb.setAttribute('aria-expanded',String(open));if(open){buildMenu();const f=menu.querySelector('.mi:not([disabled])');if(f&&!IS_TOUCH)f.focus();}};
  mb.onclick=(e)=>{e.stopPropagation();setMenu(menu.hidden);};
  document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!menu.contains(e.target)&&!mb.contains(e.target))setMenu(false);});
  menu.addEventListener('keydown',e=>{const its=[...menu.querySelectorAll('.mi:not([disabled]),.sub button')];const i=its.indexOf(document.activeElement);
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setMenu(false);mb.focus();}
    else if(e.key==='ArrowDown'){e.preventDefault();(its[i+1]||its[0])?.focus();}
    else if(e.key==='ArrowUp'){e.preventDefault();(its[i-1]||its[its.length-1])?.focus();}});
  new MutationObserver(()=>{if(menu.hidden)mb.setAttribute('aria-expanded','false');}).observe(menu,{attributes:true,attributeFilter:['hidden']});
  $('#modeWalls').onclick=()=>{if(P.mode!=='walls')setMode('walls');};
  $('#modeFurn').onclick=()=>{if(P.mode!=='furniture')setMode('furniture');};
  $('#btnLock').onclick=()=>{const st=lockState();if(st.count===0){toast('Нет объектов для фиксации');return;}lockAll(!st.all);};
  $('#btnFinish').onclick=finishFlow;$('#btnFinish').prepend(ic('sparkles'));$('#btnFinish').title='ИИ‑дизайнер: подберёт товары на места, расставит мебель и предложит отделку';
  $('#projName').onchange=e=>{P.name=e.target.value||'Новый проект';save();};
}
function buildMenu(){
  const menu=$('#menu');menu.innerHTML='';
  if(typeof accountMenuItems==='function')accountMenuItems(menu);
  const chkItem=(icn,label,on,fn)=>h('button',{type:'button',class:'mi',role:'menuitemcheckbox','aria-checked':String(!!on),onclick:()=>{fn();buildMenu();}},ic(icn),label,on?h('span',{class:'chk'},ic('check')):null);
  if(MQ_PHONE.matches&&!T3.active){const ni=h('input',{value:P.name,'aria-label':'Название проекта',autocomplete:'off',spellcheck:'false',maxlength:'80'});ni.onchange=()=>{P.name=ni.value.trim()||'Новый проект';$('#projName').value=P.name;save();};menu.append(h('div',{class:'mh'},'Проект'),h('div',{class:'mname'},ni),h('hr'));}
  if(window.innerWidth<900&&!T3.active){
    menu.append(h('div',{class:'mh'},'Вид'));
    const pts=chkItem('eye','Точки обзора',P.closed&&P.viewPointsVisible,()=>{if(P.closed)togglePoints();}); if(!P.closed)pts.disabled=true; menu.append(pts);
    menu.append(chkItem('ruler','Размеры',P.showDims,toggleDims));
    menu.append(h('button',{type:'button',class:'mi',role:'menuitem',onclick:()=>{menu.hidden=true;fitRoom();}},ic('maximize'),'Показать комнату'),h('hr'));
  }
  if((P.furniture||[]).some(f=>f.aiPolicy)){menu.append(chkItem('sparkles','Показывать права ИИ на плане',P.showAiBadges,()=>{P.showAiBadges=!P.showAiBadges;save();updateTools();render();}),h('hr'));}
  /* служебный просмотр данных для ИИ‑дизайнера — только по адресу с ?debug=1: обычному пользователю JSON ни к чему */
  if(P.brief&&/[?&]debug=1(&|$)/.test(location.search)){menu.append(h('button',{type:'button',class:'mi',role:'menuitem',onclick:()=>{menu.hidden=true;showBriefJson();}},ic('copy'),'Бриф (JSON)'),h('hr'));}
  if(typeof orderMenuItems==='function')orderMenuItems(menu);
  menu.append(h('div',{class:'mi',style:'cursor:default'},ic('ruler'),'Единицы измерения'));
  const sub=h('div',{class:'sub'});Object.keys(UNITS).forEach(u=>sub.append(h('button',{class:u===P.unit?'on':'',onclick:()=>{P.unit=u;$('#unitSel').value=u;save();render();buildMenu();}},UNITS[u].l)));menu.append(sub,h('hr'));
  if(READONLY)return;
  menu.append(h('button',{type:'button',class:'mi',role:'menuitem',onclick:async()=>{menu.hidden=true;const r=await roomParamsDialog();if(!r)return;const err=apply(Q=>{Object.assign(Q,r);Q.wallParamsSet=true;Q.openings.forEach(o=>{if(o.kind==='window')o.head=Q.wallHeight-o.sill-o.height;});});if(err)toast(err,true);}},ic('settings'),'Параметры комнаты'));
  menu.append(h('hr'),h('button',{type:'button',class:'mi danger',role:'menuitem',onclick:async()=>{menu.hidden=true;if(await confirmDlg('Очистить проект?','Все стены, проёмы и мебель будут удалены.','Очистить проект',true)){const name=P.name;P=newProject();P.name=name;D=derive(P);E.sel=null;E.mode='idle';E.tool='select';snapshot();save();updateTools();updateModeUI();fitRoom();}}},ic('trash'),'Очистить проект'));
}
function lockState(){const items=P.mode==='furniture'?(P.furniture||[]):[...P.walls,...P.openings];const n=items.length;const l=items.filter(x=>x.locked).length;return {count:n,locked:l,all:n>0&&l===n};}
function updateLockBtn(){
  const b=$('#btnLock');if(!b)return;const st=lockState();b.innerHTML='';
  b.append(lockIcon(st.all));
  let tip;
  if(st.count===0)tip='Нет объектов для фиксации';
  else if(st.all)tip='Всё заперто. Нажмите, чтобы отпереть';
  else if(st.locked>0){tip=`Заперто ${st.locked} из ${st.count}. Нажмите, чтобы запереть все`;b.append(h('span',{class:'pdot'}));}
  else tip='Зафиксировать все объекты (только в редакторе)';
  b.disabled=st.count===0; b.classList.toggle('on',st.all); b.setAttribute('aria-pressed',String(st.all)); setTip(b,tip);
}
/* ---------- Нижняя панель и каталог‑лист (телефоны) ---------- */
function setCatalogOpen(open){document.body.classList.toggle('cat-open',!!open);const b=$('#dockCat');if(b)b.setAttribute('aria-expanded',String(!!open));if(open){buildCatalog();}}
function initDock(){
  const MOD=IS_MAC?'⌘':'Ctrl+';
  document.querySelectorAll('#dock [data-view]').forEach(b=>{b.type='button';b.append(ic(b.dataset.view));setTip(b,b.dataset.view==='undo'?'Отменить':'Повторить');b.onclick=b.dataset.view==='undo'?undo:redo;});
  $('#dockCat').onclick=()=>setCatalogOpen(!document.body.classList.contains('cat-open'));
  const place=()=>{const tools=$('#tools');if(MQ_PHONE.matches)$('#dock .dk-tools').append(tools);else $('main').insertBefore(tools,$('#props'));if(!MQ_PHONE.matches)setCatalogOpen(false);};
  place(); MQ_PHONE.addEventListener('change',()=>{place();$('#menu').hidden=true;});
  cv.addEventListener('pointerdown',e=>{if(document.body.classList.contains('cat-open')&&MQ_PHONE.matches){setCatalogOpen(false);}},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('cat-open')&&!E.dialogOpen){setCatalogOpen(false);}});
  /* подсказка 3D зависит от режима (обзор или вид изнутри) — её ставит show3DHint() в view3d/scene.js */
}
/* ---------- Подсказки (tooltip) ---------- */
const IS_MAC=/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent);
function setTip(el,text){el.dataset.tip=text;el.setAttribute('aria-label',text);el.removeAttribute('title');if(TIP.el===el&&TIP.node)TIP.node.textContent=text;}
const TIP={el:null,node:null,timer:null,suppress:false};
function showTip(el){hideTip();const t=el.dataset.tip;if(!t)return;const n=h('div',{id:'tip',role:'tooltip'},t);document.body.append(n);const r=el.getBoundingClientRect();const w=n.offsetWidth;n.style.left=Math.max(8,Math.min(window.innerWidth-w-8,r.left+r.width/2-w/2))+'px';n.style.top=(r.bottom+6)+'px';TIP.el=el;TIP.node=n;}
function hideTip(){clearTimeout(TIP.timer);if(TIP.node)TIP.node.remove();TIP.node=null;TIP.el=null;}
function initTips(){
  document.querySelectorAll('header .iconbtn').forEach(el=>{
    el.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){clearTimeout(TIP.timer);TIP.timer=setTimeout(()=>showTip(el),400);}});
    el.addEventListener('pointerleave',hideTip);
    el.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'){hideTip();return;}clearTimeout(TIP.timer);TIP.suppress=false;TIP.timer=setTimeout(()=>{TIP.suppress=true;showTip(el);},500);});
    el.addEventListener('pointerup',e=>{if(e.pointerType!=='mouse'){clearTimeout(TIP.timer);setTimeout(hideTip,1200);}});
    el.addEventListener('click',e=>{if(TIP.suppress){TIP.suppress=false;e.stopImmediatePropagation();e.preventDefault();}},true);
    el.addEventListener('focus',()=>{if(el.matches(':focus-visible'))showTip(el);});
    el.addEventListener('blur',hideTip);
  });
}

/* ---------- Компактный виджет и панель свойств ---------- */
function compactInfo(sel){
  if(sel.type==='wall'){const i=D.W.get(sel.id);const n=P.walls.findIndex(w=>w.id===sel.id)+1;return {title:`Стена ${n}`,sub:`${fmt(i.len)} × ${fmtU(P.wallHeight)}`,lock:true};}
  if(sel.type==='opening'){const o=P.openings.find(x=>x.id===sel.id);const rw=rowOf(o);return {title:o.name,sub:`${fmt(o.width)} × ${fmtU(o.height)}`+(o.kind==='window'&&rw.length>1?` · ряд из ${rw.length}`:''),lock:true};}
  if(sel.type==='furniture'){const f=P.furniture.find(x=>x.id===sel.id);const t=TYPE.get(f.typeId),fo=formOf(t,f.formId);return {title:f.name,sub:fo.dims.map(k=>fmt(f.dims[k])).join('×')+' '+UNITS[P.unit].l,lock:true};}
  if(sel.type==='vertex'){return {title:'Точка',sub:'',lock:false};}
  if(sel.type==='floor'){return {title:'Пол',sub:m2(Math.abs(D.area)),lock:false};}
  return {title:'',sub:'',lock:false};
}
function updateWidget(){
  const wg=$('#widget'),pn=$('#props'); const sel=E.sel;
  if(!sel||E.drag||E.mode!=='idle'||T3.active){wg.hidden=true;pn.hidden=true;return;}
  if(E.propsOpen){wg.hidden=true;pn.hidden=false;const r=buildFullWidget(pn);if(!r){pn.hidden=true;return;}(pn.querySelector('.ph')||pn).prepend(h('button',{type:'button',class:'back','aria-label':'Назад к плану',title:'Назад (Esc)',onclick:()=>{E.propsOpen=false;render();}},ic('chevron-left')));return;}
  pn.hidden=true; const scratch=document.createElement('div'); const r=buildFullWidget(scratch); if(!r){wg.hidden=true;return;}
  const info=compactInfo(sel); wg.hidden=false; wg.className='capsule'; wg.innerHTML='';
  wg.append(h('b',{},info.title)); if(info.sub)wg.append(h('span',{},info.sub));
  if(info.lock){const lk=isLocked(sel),t=lk?'Снять фиксацию':'Зафиксировать';wg.append(h('button',{type:'button',class:'iconbtn','aria-pressed':String(lk),'aria-label':t,title:t+' (L)',onclick:(e)=>{e.stopPropagation();toggleLock(sel);}},lockIcon(lk)));}
  wg.append(h('button',{type:'button',onclick:(e)=>{e.stopPropagation();E.propsOpen=true;render();}},'Свойства',ic('chevron-right')));
  const a=S(r.anchor); const n=r.n; const z=vp().zoom; const off=P.wallThickness*z+DIM_OFF*2+16; const W=wg.offsetWidth||220,H=36;
  let x=a.x+n.x*off,y=a.y+n.y*off; if(Math.abs(n.x)>Math.abs(n.y)){x=n.x>0?x:x-W;y-=H/2;}else{y=n.y>0?y:y-H;x-=W/2;}
  const padB=MQ_PHONE.matches?(P.mode==='furniture'?76:128):8; x=Math.max(8,Math.min(E.W-8-W,x)); y=Math.max(8,Math.min(E.H-padB-H,y)); wg.style.left=x+'px'; wg.style.top=y+'px';
}

/* ---------- AI‑бейджи на плане ---------- */
/* значок права ИИ на плане — короткой русской подписью: «AI K / M / R / F» никто не расшифровывал */
const AI_LETTER={keep:'не менять',move:'двигать',replace:'заменить',free:'любые правки'};
const AI_NAME={keep:'Ничего',move:'Двигать',replace:'Заменить',free:'Двигать и заменять'};
function drawAiBadge(ctx,x,y,pol){const t='ИИ: '+(AI_LETTER[pol]||'');ctx.save();ctx.font='600 10px '+cssv('--font');const w=ctx.measureText(t).width+10;ctx.fillStyle=cssv('--brand-soft');ctx.strokeStyle=cssv('--brand');ctx.lineWidth=1;rr(x-w/2,y-8,w,16,8);ctx.fill();ctx.stroke();ctx.fillStyle=cssv('--brand');ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(t,x,y+0.5);ctx.restore();}
