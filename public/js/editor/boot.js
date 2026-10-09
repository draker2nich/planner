'use strict';
/* furnitech · редактор · boot.js
   Запуск редактора. Подключается последним из файлов ядра и интерфейса, перед account.js.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ================= Инициализация ================= */
(function init(){
  const saved=load(); P=normalizeProject(saved||newProject());
  D=derive(P); $('#projName').value=P.name; $('#unitSel').value=P.unit;
  resize(); if(!saved){fitRoom();} else {setView(vp().x,vp().y,vp().zoom);}
  document.querySelectorAll('#tools [data-tool]').forEach(b=>{b.onclick=()=>setTool(b.dataset.tool);b.append(ic({select:'cursor',wall:'wall',door:'door',window:'window',arch:'arch'}[b.dataset.tool]),h('span',{},{select:'Выбор',wall:'Стена',door:'Дверь',window:'Окно',arch:'Арка'}[b.dataset.tool]));});
  const MOD=IS_MAC?'⌘':'Ctrl+';
  const VTIP={points:'Точки обзора (P)',dims:'Размеры (D)',fit:'Показать комнату (F)',undo:`Отменить (${MOD}Z)`,redo:IS_MAC?'Повторить (⌘⇧Z)':'Повторить (Ctrl+Y)'};
  document.querySelectorAll('header [data-view]').forEach(b=>{b.append(ic({points:'eye',dims:'ruler',fit:'maximize',undo:'undo',redo:'redo'}[b.dataset.view]));setTip(b,VTIP[b.dataset.view]);});
  initTips();
  initDock();
  initHeader(); loadCatalog(); snapshot(); updateTools(); updateModeUI(); if(P.mode==='furniture'){if(!P.closed)P.mode='walls';else buildCatalog();} updateModeUI(); render(); if(P.status==='submitted'&&P.brief)showResult(); reportSanitized();
})();
