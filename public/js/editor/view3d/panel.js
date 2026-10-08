'use strict';
/* furnitech · редактор · view3d/panel.js
   Панель материалов стен и пола.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ---------- Панель материалов ---------- */
function getMaterialOf(sel){return sel.type==='floor'?(P.floor?.material):(P.walls.find(w=>w.id===sel.id)?.material);}
function setMaterial(sel,m,commit){
  if(commit){const err=apply(Q=>{if(sel.type==='floor'){Q.floor=Q.floor||{};Q.floor.material=m;}else{const w=Q.walls.find(x=>x.id===sel.id);if(w)w.material=m;}});if(err)toast(err,true);return;}
  // live preview без истории
  const mesh=T3.pickables.find(x=>sel.type==='floor'?x.userData.type==='floor':x.userData.id===sel.id); if(!mesh)return;
  if(sel.type==='floor'){const poly=innerPoly();const xs=poly.map(p=>p.x/1000),ys=poly.map(p=>-p.y/1000);mesh.material=buildMaterial(m,Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys),Math.min(...xs),Math.min(...ys),true);}
  else{const wm=buildMaterial(m,mesh.userData.L,mesh.userData.H);mesh.material=[wm,wm,mesh.material[2]];}
}
function openMaterialPanel(sel){
  const pn=$('#matPanel'); pn.hidden=false; pn.innerHTML=''; T3.panelTarget=sel; document.body.classList.add('mat-open'); const cur=JSON.parse(JSON.stringify(getMaterialOf(sel)||{type:'color',color:sel.type==='floor'?FLOOR_DEF:WALL_DEF}));
  const title=sel.type==='floor'?'Пол':'Стена '+(P.walls.findIndex(w=>w.id===sel.id)+1);
  pn.classList.toggle('collapsed',!!P.panelCollapsed); pn.append(h('h4',{},h('button',{type:'button',class:'coll','aria-label':'Свернуть или развернуть панель',title:'Свернуть/развернуть',onclick:toggleMatPanel},ic('chevron-right')),h('span',{style:'flex:1'},title),h('button',{type:'button',class:'x','aria-label':'Закрыть панель',onclick:()=>selectIn3D(null)},ic('close'))));
  const tabs=h('div',{class:'tabs'}); const body=h('div',{class:'tbody'}); pn.append(tabs,body);
  const names={color:'Цвет',texture:'Текстура',photo:'Фото'}; let active=cur.type;
  const commit=(m)=>{setMaterial(sel,m,true);};
  const live=(m)=>{setMaterial(sel,m,false);};
  const rowSlider=(lbl,val,min,max,step,onLive,onCommit,fmtv)=>{const inp=h('input',{type:'range',min,max,step,value:val});const vs=h('span',{},fmtv?fmtv(val):val);inp.oninput=()=>{vs.textContent=fmtv?fmtv(+inp.value):inp.value;onLive(+inp.value);};inp.onchange=()=>onCommit(+inp.value);return h('div',{class:'row'},h('span',{},lbl),inp,vs);};
  const commonTexControls=(m)=>{const box=h('div',{});
    box.append(rowSlider('Масштаб',m.scale||100,50,200,5,v=>{m.scale=v;live(m);},v=>{m.scale=v;commit(m);},v=>v+'%'));
    const rot=h('select',{},...[0,90,180,270].map(r=>h('option',{value:r},r+'°')));rot.value=m.rotation||0;rot.onchange=()=>{m.rotation=+rot.value;commit(m);};box.append(h('div',{class:'row'},h('span',{},'Поворот'),rot));
    box.append(rowSlider('Смещение X',(m.offset||[0,0])[0],0,100,1,v=>{m.offset=[v,(m.offset||[0,0])[1]];live(m);},v=>{m.offset=[v,(m.offset||[0,0])[1]];commit(m);},v=>v+'%'));
    box.append(rowSlider('Смещение Y',(m.offset||[0,0])[1],0,100,1,v=>{m.offset=[(m.offset||[0,0])[0],v];live(m);},v=>{m.offset=[(m.offset||[0,0])[0],v];commit(m);},v=>v+'%'));
    return box;};
  const renderTab=()=>{
    body.innerHTML=''; [...tabs.children].forEach(t=>t.classList.toggle('on',t.dataset.t===active));
    if(active==='color'){
      const m=cur.type==='color'?cur:{type:'color',color:sel.type==='floor'?FLOOR_DEF:WALL_DEF,roughness:sel.type==='floor'?0.6:0.9};
      const presets=['#ffffff','#f4f1ea','#e9e6df','#d9d2c5','#c9c2b6','#a9a39b','#6b6f76','#2f3237','#f7e1c8','#e8c9a6','#d9a877','#c58b5a','#b5563d','#8a5a3c','#d9cfbf','#a97c50','#dfe8f8','#bcd4ea','#8fbcd9','#5c93b5','#cfe3d6','#9fc7ad','#5f9a78','#2e6b52'];
      const pal=h('div',{class:'pal'},...presets.map(c=>h('button',{type:'button',style:'background:'+c,title:c,'aria-label':'Цвет '+c,onclick:()=>{m.color=c;hex.value=c;pick.value=c;commit(m);}})));
      const hex=h('input',{type:'text',value:m.color,maxlength:'7'}); hex.onchange=()=>{if(/^#[0-9a-f]{6}$/i.test(hex.value)){m.color=hex.value.toLowerCase();pick.value=m.color;commit(m);}else{toast('Формат #RRGGBB',true);hex.value=m.color;}};
      const pick=h('input',{type:'color',value:m.color}); pick.oninput=()=>{m.color=pick.value;hex.value=pick.value;live(m);}; pick.onchange=()=>commit(m);
      body.append(pal,h('div',{class:'row'},h('span',{},'HEX'),hex,pick),rowSlider('Матовость',m.roughness??0.9,0.3,1,0.05,v=>{m.roughness=v;live(m);},v=>{m.roughness=v;commit(m);},v=>Math.round(v*100)+'%'));
    } else if(active==='texture'){
      const m=cur.type==='texture'?cur:{type:'texture',textureId:null,scale:100,rotation:0,offset:[0,0]};
      const cats={all:'Все',paint:'Краска',wallpaper:'Обои',tile:'Плитка',wood:'Дерево',stone:'Камень',concrete:'Бетон'}; let cat='all';
      const flt=h('select',{},...Object.keys(cats).map(k=>h('option',{value:k},cats[k]))); const grid=h('div',{class:'grid'});
      const fill=()=>{grid.innerHTML='';TEXLIB.filter(t=>(sel.type==='floor'?t.forFloor:t.forWalls)&&(cat==='all'||t.cat===cat)).forEach(t=>{const c=getLibCanvas(t.id);const im=h('button',{type:'button','aria-pressed':String(m.textureId===t.id),class:'ti'+(m.textureId===t.id?' on':''),title:`${t.name} · ${fmt(t.physW)}×${fmt(t.physH)} ${UNITS[P.unit].l}`});im.style.backgroundImage=`url(${t.url||(t.url=c.toDataURL('image/jpeg',0.7))})`;im.append(h('span',{},t.name));im.onclick=()=>{m.textureId=t.id;commit(m);};grid.append(im);});};
      flt.onchange=()=>{cat=flt.value;fill();}; fill(); body.append(h('div',{class:'row'},h('span',{},'Категория'),flt),grid); if(m.textureId)body.append(commonTexControls(m));
    } else {
      const m=cur.type==='photo'?cur:{type:'photo',photoId:null,mode:'stretch',fit:'cover',align:'cc',physW:1000,scale:100,rotation:0,offset:[0,0]};
      const file=h('input',{type:'file',accept:'image/jpeg,image/png,image/webp'}); const drop=h('div',{class:'drop'},'Перетащите фото сюда, вставьте из буфера или ',h('label',{class:'lnk'},'выберите файл',file));
      const doImport=async(f)=>{if(!f)return;try{const id=await importPhoto(f);m.photoId=id;commit(m);}catch(err){toast(err.message,true);}};
      file.onchange=()=>doImport(file.files[0]); drop.ondragover=e=>{e.preventDefault();drop.classList.add('over');}; drop.ondragleave=()=>drop.classList.remove('over'); drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');doImport(e.dataTransfer.files[0]);};
      pn.onpaste=e=>{const it=[...(e.clipboardData?.items||[])].find(i=>i.type.startsWith('image/'));if(it){doImport(it.getAsFile());}};
      body.append(drop);
      const list=h('div',{class:'grid'}); body.append(h('div',{class:'row'},h('span',{},'Мои фото'),h('button',{onclick:gcPhotos},'Очистить неиспользуемые')),list);
      photoLibrary().then(all=>{all.sort((a,b)=>b.createdAt-a.createdAt).forEach(rec=>{const url=URL.createObjectURL(rec.blob);const im=h('div',{class:'ti'+(m.photoId===rec.id?' on':''),role:'button',tabindex:'0','aria-label':'Фото '+new Date(rec.createdAt).toLocaleDateString()});im.style.backgroundImage=`url(${url})`;im.onclick=()=>{m.photoId=rec.id;commit(m);};im.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();im.click();}};const del=h('button',{type:'button',class:'x','aria-label':'Удалить фото',onclick:async(e)=>{e.stopPropagation();if(usedPhotoIds().has(rec.id)){toast('Это фото используется в проекте. Сначала выберите для поверхности другой материал',true);return;}await photoDelete(rec.id);save();if(m.photoId===rec.id){m.photoId=null;}renderTab();}},ic('close'));im.append(del);list.append(im);});if(!all.length)list.append(h('div',{class:'hint'},'Пока нет фото'));});
      if(m.photoId){
        const mode=h('select',{},h('option',{value:'stretch'},'Растянуть'),h('option',{value:'tile'},'Плитка'));mode.value=m.mode;mode.onchange=()=>{m.mode=mode.value;commit(m);}; body.append(h('div',{class:'row'},h('span',{},'Режим'),mode));
        if(m.mode==='stretch'){const fit=h('select',{},h('option',{value:'cover'},'С обрезкой'),h('option',{value:'contain'},'С полями'));fit.value=m.fit||'cover';fit.onchange=()=>{m.fit=fit.value;commit(m);};
          const al=h('select',{},...['tl','tc','tr','cl','cc','cr','bl','bc','br'].map(a=>h('option',{value:a},({t:'верх',c:'центр',b:'низ'})[a[0]]+' / '+({l:'лево',c:'центр',r:'право'})[a[1]])));al.value=m.align||'cc';al.onchange=()=>{m.align=al.value;commit(m);};
          const rot=h('select',{},...[0,90,180,270].map(r=>h('option',{value:r},r+'°')));rot.value=m.rotation||0;rot.onchange=()=>{m.rotation=+rot.value;commit(m);};
          body.append(h('div',{class:'row'},h('span',{},'Подгонка'),fit),h('div',{class:'row'},h('span',{},'Выравнивание'),al),h('div',{class:'row'},h('span',{},'Поворот'),rot));}
        else{const pw=h('input',{type:'text',value:fmt(m.physW||1000)});pw.onchange=()=>{const v=parseLen(pw.value);if(isNaN(v)||v<50){toast('Введите ширину',true);return;}m.physW=v;commit(m);};body.append(h('div',{class:'row'},h('span',{},'Ширина изображения'),pw,h('span',{},UNITS[P.unit].l)),commonTexControls(m));}
      }
    }
  };
  Object.keys(names).forEach(t=>tabs.append(h('button',{type:'button','data-t':t,onclick:()=>{active=t;renderTab();}},names[t])));
  renderTab();
  const foot=h('div',{class:'foot'});
  if(sel.type==='wall')foot.append(h('button',{onclick:()=>{const m=getMaterialOf(sel);const err=apply(Q=>{Q.walls.forEach(w=>{w.material=m?JSON.parse(JSON.stringify(m)):undefined;});});if(err)toast(err,true);else toast('Применено ко всем стенам');}},'Ко всем стенам'));
  foot.append(h('button',{onclick:()=>{setMaterial(sel,sel.type==='floor'?{type:'color',color:FLOOR_DEF}:undefined,true);}},'Сбросить'),h('button',{onclick:()=>selectIn3D(null)},'Закрыть'));
  pn.append(foot);
}
function closeMaterialPanel(){const pn=$('#matPanel');pn.hidden=true;document.body.classList.remove('mat-open');pn.innerHTML='';T3.panelTarget=null;}
