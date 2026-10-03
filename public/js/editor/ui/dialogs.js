'use strict';
/* furnitech · редактор · ui/dialogs.js
   Диалоги: параметры стен, длина, проём, положение проёма и ряда, параметры комнаты.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ================= Диалоги ================= */
function dialog(build){
  return new Promise(res=>{
    const ov=$('#overlay'),box=$('#dlg'); box.innerHTML=''; box.className=''; box.onpaste=null; ov.hidden=false; E.dialogOpen=true; const prevFocus=document.activeElement;
    const errEl=h('div',{class:'err'});
    const api={close:(r)=>{ov.hidden=true;E.dialogOpen=false;box.innerHTML='';box.onkeydown=null;box.removeAttribute('aria-labelledby');if(prevFocus&&prevFocus.isConnected&&prevFocus.focus)try{prevFocus.focus({preventScroll:true});}catch(e){}res(r);},err:(m)=>{errEl.textContent=m||'';},errEl};
    build(box,api); box.appendChild(errEl);
    const btns=h('div',{class:'btns'}); box.appendChild(btns);
    const ttl=box.querySelector('h3'); if(ttl){ttl.id='dlgTitle';box.setAttribute('aria-labelledby','dlgTitle');}
    (api.buttons||[]).forEach(b=>{const el=h('button',{type:'button',class:b.primary?'primary':''},b.label); el.onclick=()=>b.onClick(api); if(b.primary)api.primaryBtn=el; if(b.cancel)api.cancelBtn=el; btns.appendChild(el);});
    if(api.setup)api.setup();
    box.onkeydown=(e)=>{ if(e.key==='Enter'&&e.target.tagName!=='TEXTAREA'&&api.primaryBtn&&!api.primaryBtn.disabled){e.preventDefault();api.primaryBtn.click();} if(e.key==='Escape'&&api.cancelBtn){e.preventDefault();api.cancelBtn.click();} e.stopPropagation(); };
    const fi=box.querySelector('input:not([readonly]):not([type=file]),select,button'); if(fi&&!IS_TOUCH){fi.focus(); if(fi.select)fi.select();} else box.focus({preventScroll:true});
  });
}
function numRow(label,mm,opts={}){
  const inp=h('input',{type:'text',inputmode:'decimal',value:mm==null?'':fmt(mm,opts.unit)}); if(opts.readonly)inp.readOnly=true;
  const row=h('div',{class:'f'},h('label',{},label),h('div',{class:'val'},inp,h('span',{},opts.unitLabel||UNITS[opts.unit||P.unit].l)));
  return {row,inp,get:()=>parseLen(inp.value,opts.unit||P.unit),set:(v)=>{inp.value=fmt(v,opts.unit||P.unit);},unitSpan:row.querySelector('span')};
}
function unitRow(){const sel=h('select',{},...Object.keys(UNITS).map(u=>h('option',{value:u},UNITS[u].l))); sel.value=P.unit; return {row:h('div',{class:'f'},h('label',{},'Единицы'),sel),sel};}
function confirmDlg(title,text){return dialog((box,api)=>{box.append(h('h3',{},title),h('div',{class:'hint'},text)); api.buttons=[{label:'Отмена',cancel:true,onClick:a=>a.close(false)},{label:'Да',primary:true,onClick:a=>a.close(true)}];});}

async function wallParamsDialog(){
  return dialog((box,api)=>{
    box.append(h('h3',{},'Параметры стен'));
    const H=numRow('Высота стены',P.wallHeight), T=numRow('Толщина стены',P.wallThickness); const U=unitRow();
    const chk=h('input',{type:'checkbox'}); chk.checked=P.lengthsIncludeThickness;
    U.sel.onchange=()=>{const hv=H.get(),tv=T.get();P.unit=U.sel.value;$('#unitSel').value=P.unit;if(!isNaN(hv))H.inp.value=fmt(hv);if(!isNaN(tv))T.inp.value=fmt(tv);H.unitSpan.textContent=T.unitSpan.textContent=UNITS[P.unit].l;};
    box.append(U.row,H.row,T.row,h('label',{class:'chk'},chk,h('span',{},'Введённые длины включают толщину стены',h('div',{class:'hint'},'Выкл: вводится чистый внутренний размер. Вкл: наружный размер, внутренний считается автоматически.'))));
    api.buttons=[{label:'Отмена',cancel:true,onClick:a=>a.close(null)},{label:'Продолжить',primary:true,onClick:a=>{
      const hv=H.get(),tv=T.get(); if(isNaN(hv)||isNaN(tv))return a.err('Введите значения');
      if(hv<MIN_H||hv>MAX_H)return a.err(`Высота: ${fmtU(MIN_H)} … ${fmtU(MAX_H)}`); if(tv<MIN_T||tv>MAX_T)return a.err(`Толщина: ${fmtU(MIN_T)} … ${fmtU(MAX_T)}`);
      a.close({wallHeight:hv,wallThickness:tv,lengthsIncludeThickness:chk.checked});}}];
  });
}
async function lengthDialog(lenMm,opts={}){ // opts.closing, opts.title
  return dialog((box,api)=>{
    box.append(h('h3',{},opts.title||(opts.closing?'Замкнуть контур':'Длина стены')));
    const U=unitRow(); const L=numRow(opts.closing?'Длина (по геометрии)':'Длина',lenMm,{readonly:!!opts.closing});
    if(opts.closing) box.append(h('div',{class:'hint'},'Конец стены совпадает с началом контура — длина определена.'));
    if(P.lengthsIncludeThickness&&!opts.closing) box.append(h('div',{class:'hint'},'Вводится наружный размер (включая толщину стены).'));
    U.sel.onchange=()=>{const v=L.get();P.unit=U.sel.value;$('#unitSel').value=P.unit;if(!isNaN(v))L.inp.value=fmt(v);L.unitSpan.textContent=UNITS[P.unit].l;render();};
    box.append(U.row,L.row);
    api.buttons=[{label:'Отмена',cancel:true,onClick:a=>a.close(null)},{label:opts.closing?'Замкнуть':'ОК',primary:true,onClick:a=>{
      if(opts.closing)return a.close({len:lenMm});
      const v=L.get(); if(isNaN(v))return a.err('Введите длину');
      const inner=P.lengthsIncludeThickness?v-2*P.wallThickness:v;
      if(inner<MIN_WALL||inner>MAX_WALL)return a.err(`Допустимая длина: ${fmtU(MIN_WALL)} … ${fmtU(MAX_WALL)}`+(P.lengthsIncludeThickness?' (внутренний размер)':''));
      if(opts.validate){const e=opts.validate(inner); if(e)return a.err(e);}
      a.close({len:inner,entered:P.lengthsIncludeThickness?v:undefined});}}];
  });
}
async function openingDialog(kind,init){
  return dialog((box,api)=>{
    box.append(h('h3',{},KIND_NAME[kind]));
    const U=unitRow(); const Wr=numRow('Ширина',init?.width??DEF[kind].w), Hr=numRow('Высота',init?.height??DEF[kind].h); box.append(U.row,Wr.row,Hr.row);
    const all=[Wr,Hr]; let Rr,Sr,Cr,btnAny; let anyChosen=false;
    if(kind==='arch'){
      Rr=numRow('Радиус скругления',init?.radius??null); all.push(Rr);
      btnAny=h('button',{class:'alt',type:'button'},'Без разницы');
      btnAny.onclick=()=>{anyChosen=!anyChosen;btnAny.classList.toggle('on',anyChosen);Rr.inp.value='';Rr.inp.disabled=anyChosen;upd();};
      Rr.inp.oninput=()=>{anyChosen=false;btnAny.classList.remove('on');upd();};
      box.append(Rr.row,h('div',{class:'hint'},'Обязательно: введите значение или нажмите «Без разницы» (= половина ширины). 0 — прямоугольный проём.'),btnAny);
      if(init&&init.radius===init.width/2){anyChosen=true;btnAny.classList.add('on');Rr.inp.value='';Rr.inp.disabled=true;}
    }
    let lock='sill'; // какое поле вводится
    if(kind==='window'){
      Sr=numRow('От пола',init?.sill??null); Cr=numRow('До потолка',init?.head??null); all.push(Sr,Cr);
      btnAny=h('button',{class:'alt',type:'button'},'Без разницы');
      const recompute=(src)=>{const hh=Hr.get(); if(isNaN(hh))return; if(src==='sill'){const s=Sr.get(); if(!isNaN(s)){Cr.inp.value=fmt(P.wallHeight-s-hh);}} else {const c=Cr.get(); if(!isNaN(c)){Sr.inp.value=fmt(P.wallHeight-c-hh);}}};
      Sr.inp.onfocus=()=>{lock='sill';Cr.inp.readOnly=true;Sr.inp.readOnly=false;}; Cr.inp.onfocus=()=>{lock='head';Sr.inp.readOnly=true;Cr.inp.readOnly=false;};
      Sr.inp.oninput=()=>{anyChosen=false;btnAny.classList.remove('on');recompute('sill');upd();}; Cr.inp.oninput=()=>{anyChosen=false;btnAny.classList.remove('on');recompute('head');upd();};
      Hr.inp.oninput=()=>{recompute(lock);upd();};
      btnAny.onclick=()=>{anyChosen=true;btnAny.classList.add('on');Sr.inp.value=fmt(DEF.window.sill);recompute('sill');upd();};
      box.append(Sr.row,Cr.row,h('div',{class:'hint'},`Введите одно из значений — второе посчитается (высота стены ${fmtU(P.wallHeight)}). «Без разницы» = подоконник ${fmtU(DEF.window.sill)}.`),btnAny);
      if(init){recompute('sill');}
      if(!init){ // ряд одинаковых окон
        const cnt=h('input',{type:'text',inputmode:'numeric',value:'1',id:'winCount','aria-label':'Количество окон',autocomplete:'off',style:'width:56px;text-align:center'});
        const getN=()=>{const v=Number(String(cnt.value).trim());return Number.isInteger(v)?v:NaN;};
        const step=(d)=>{const v=getN();cnt.value=String(Math.max(1,Math.min(MAX_ROW,(isNaN(v)?1:v)+d)));refreshRow();};
        const minus=h('button',{type:'button',class:'iconbtn sm','aria-label':'Меньше окон'},'−'), plus=h('button',{type:'button',class:'iconbtn sm','aria-label':'Больше окон'},'+');
        minus.onclick=()=>step(-1); plus.onclick=()=>step(1);
        cnt.onkeydown=(e)=>{if(e.key==='ArrowUp'){e.preventDefault();step(1);}else if(e.key==='ArrowDown'){e.preventDefault();step(-1);}};
        cnt.oninput=()=>refreshRow();
        const cntRow=h('div',{class:'f'},h('label',{for:'winCount'},'Количество'),h('div',{class:'val stepper'},minus,cnt,plus));
        let layout='even';
        const seg=h('div',{class:'seg',role:'group','aria-label':'Расстановка окон'});
        const segBtn=(v,l)=>{const b=h('button',{type:'button','aria-pressed':String(layout===v)},l);b.onclick=()=>{layout=v;[...seg.children].forEach(x=>{const on=x===b;x.classList.toggle('on',on);x.setAttribute('aria-pressed',String(on));});refreshRow();};if(layout===v)b.classList.add('on');return b;};
        seg.append(segBtn('even','Равномерно по стене'),segBtn('gap','С простенком'));
        const segRow=h('div',{class:'f'},h('label',{},'Расстановка'),seg);
        const Gr=numRow('Простенок',DEF_PIER);
        const rowHint=h('div',{class:'hint'});
        const rowBox=h('div',{hidden:true},segRow,Gr.row,rowHint);
        function refreshRow(){
          const n=getN(); const multi=n>1; rowBox.hidden=!multi; Gr.row.hidden=layout!=='gap';
          rowHint.textContent=layout==='even'?`${nWin(isNaN(n)?2:n)} одинакового размера встанут в ряд на выбранной стене с равными простенками между окнами и до углов. При изменении длины стены ряд перераспределится.`:`${nWin(isNaN(n)?2:n)} одинакового размера встанут в ряд с заданным простенком; ряд можно сдвигать вдоль стены целиком.`;
        }
        all.push(Gr); box.append(h('hr',{style:'border:none;border-top:1px solid var(--border);margin:14px 0 4px'}),cntRow,rowBox); refreshRow();
        api.rowParams=()=>({n:getN(),layout,gap:Gr.get()});
      }
    }
    U.sel.onchange=()=>{const vals=all.map(r=>r.get());P.unit=U.sel.value;$('#unitSel').value=P.unit;all.forEach((r,i)=>{if(!isNaN(vals[i]))r.inp.value=fmt(vals[i]);r.unitSpan.textContent=UNITS[P.unit].l;});render();};
    const upd=()=>{ if(!api.primaryBtn)return; let ok=true; if(kind==='arch') ok=anyChosen||!isNaN(Rr.get()); if(kind==='window') ok=!isNaN(Sr.get())&&!isNaN(Cr.get()); api.primaryBtn.disabled=!ok; };
    api.setup=upd;
    api.buttons=[{label:'Отмена',cancel:true,onClick:a=>a.close(null)},{label:init?'Сохранить':'Разместить',primary:true,onClick:a=>{
      const w=Wr.get(),hh=Hr.get(); if(isNaN(w)||isNaN(hh))return a.err('Введите ширину и высоту');
      if(w<100||w>5000)return a.err(`Ширина: ${fmtU(100)} … ${fmtU(5000)}`); if(hh<500||hh>P.wallHeight)return a.err(`Высота: ${fmtU(500)} … ${fmtU(P.wallHeight)}`);
      const r={kind,width:w,height:hh};
      if(kind==='arch'){ r.radius=anyChosen?Math.round(w/2):Rr.get(); if(isNaN(r.radius))return a.err('Укажите радиус'); if(r.radius<0||r.radius>w/2)return a.err(`Радиус: 0 … ${fmtU(w/2)}`); if(r.radius>hh)return a.err('Радиус больше высоты'); }
      if(kind==='window'){ r.sill=Sr.get(); r.head=Cr.get(); if(isNaN(r.sill)||isNaN(r.head))return a.err('Укажите «от пола» или «до потолка»'); r.head=P.wallHeight-r.sill-hh; if(r.sill<0)return a.err('«От пола» не может быть меньше 0'); if(r.head<0)return a.err(`Окно не помещается по высоте: max высота = ${fmtU(P.wallHeight-r.sill)}`); }
      if(kind==='window'&&api.rowParams){ const rp=api.rowParams();
        if(isNaN(rp.n)||rp.n<1||rp.n>MAX_ROW)return a.err(`Количество окон: 1 … ${MAX_ROW}`);
        if(rp.n>1){ if(rp.layout==='gap'){ if(isNaN(rp.gap))return a.err('Введите простенок'); if(rp.gap<0)return a.err('Простенок не может быть меньше 0'); }
          const longest=Math.max(...P.walls.map(w=>D.W.get(w.id).len)); const need=rp.layout==='even'?rp.n*w+(rp.n+1)*MIN_PIER:rp.n*w+(rp.n-1)*rp.gap;
          if(need>longest+0.5)return a.err(`${nWin(rp.n)} по ${fmtU(w)} не поместятся ни на одной стене: нужно ${fmtU(Math.round(need))}, самая длинная стена ${fmtU(Math.round(longest))}`);
          r.count=rp.n; r.layout=rp.layout; r.gap=rp.layout==='gap'?rp.gap:null; } }
      a.close(r);}}];
  });
}
async function positionDialog(o){
  const info=D.W.get(o.wallId); const L=info.len;
  return dialog((box,api)=>{
    box.append(h('h3',{},`Положение: ${o.name}`));
    let fromOther=false;
    const A=numRow('От стены (опорной)',o.offset), Wr=numRow('Ширина проёма',o.width,{readonly:true}), B=numRow('До другой стены',L-o.offset-o.width,{readonly:true});
    const sw=h('button',{class:'alt',type:'button'},'Задать от другой стороны');
    sw.onclick=()=>{fromOther=!fromOther;sw.classList.toggle('on',fromOther);A.inp.readOnly=fromOther;B.inp.readOnly=!fromOther;(fromOther?B:A).inp.focus();};
    const sync=()=>{ if(fromOther){const b=B.get(); if(!isNaN(b))A.inp.value=fmt(L-b-o.width);} else {const a=A.get(); if(!isNaN(a))B.inp.value=fmt(L-a-o.width);} };
    A.inp.oninput=sync; B.inp.oninput=sync;
    box.append(h('div',{class:'hint'},`Опорная сторона: ${info.horiz?'левый':(info.ortho?'верхний':'верхний (меньший y)')} конец стены. Длина стены ${fmtU(L)}.`),A.row,Wr.row,B.row,sw);
    api.buttons=[{label:'Отмена',cancel:true,onClick:a=>a.close(null)},{label:'ОК',primary:true,onClick:a=>{
      const off=fromOther?(L-B.get()-o.width):A.get(); if(isNaN(off))return a.err('Введите значение');
      if(off<0||off>L-o.width+0.5)return a.err(`Допустимо: 0 … ${fmtU(L-o.width)}`);
      for(const q of wallOpenings(o.wallId)){ if(q.id===o.id)continue; if(off<q.offset+q.width&&q.offset<off+o.width){ return a.err(`Мешает ${q.name} (${fmtU(q.offset)}…${fmtU(q.offset+q.width)}).`);} }
      a.close({offset:Math.round(off)});}}];
  });
}
async function roomParamsDialog(){
  return dialog((box,api)=>{
    box.append(h('h3',{},'Параметры комнаты'));
    const H=numRow('Высота стен',P.wallHeight), T=numRow('Толщина стен',P.wallThickness); const chk=h('input',{type:'checkbox'}); chk.checked=P.lengthsIncludeThickness;
    box.append(H.row,T.row,h('label',{class:'chk'},chk,h('span',{},'Введённые длины включают толщину стены')));
    api.buttons=[{label:'Отмена',cancel:true,onClick:a=>a.close(null)},{label:'Применить',primary:true,onClick:a=>{
      const hv=H.get(),tv=T.get(); if(isNaN(hv)||isNaN(tv))return a.err('Введите значения');
      if(hv<MIN_H||hv>MAX_H)return a.err(`Высота: ${fmtU(MIN_H)} … ${fmtU(MAX_H)}`); if(tv<MIN_T||tv>MAX_T)return a.err(`Толщина: ${fmtU(MIN_T)} … ${fmtU(MAX_T)}`);
      const bad=P.openings.filter(o=>o.kind==='window'?o.sill+o.height>hv:o.height>hv).map(o=>o.name);
      if(bad.length)return a.err('Не помещаются по высоте: '+bad.join(', '));
      a.close({wallHeight:hv,wallThickness:tv,lengthsIncludeThickness:chk.checked});}}];
  });
}

/* Ряд целиком: отступ первого окна от опорного конца стены и простенок */
async function rowPositionDialog(row,start,opt={}){
  const info=D.W.get(row[0].wallId); const L=info.len; const n=row.length; const w=row[0].width; const ids=new Set(row.map(x=>x.id));
  const uniform=opt.gap??rowUniformGap(row);
  return dialog((box,api)=>{
    box.append(h('h3',{},`Положение ряда: ${nWin(n)}`));
    let fromOther=false;
    const G=uniform!=null?numRow('Простенок',uniform):null;
    const gapNow=()=>{if(!G)return null;const g=G.get();return isNaN(g)?NaN:g;};
    const span=()=>{const g=gapNow();return g==null?rowSpan(row):(isNaN(g)?NaN:n*w+(n-1)*g);};
    const A=numRow('От стены до первого окна',start), B=numRow('От последнего окна до другой стены',L-start-rowSpan(row),{readonly:true}), S=numRow('Ширина ряда',rowSpan(row),{readonly:true});
    const sw=h('button',{class:'alt',type:'button'},'Задать от другой стороны');
    const sync=()=>{const sp=span(); if(!isNaN(sp))S.set(sp); if(isNaN(sp))return; if(fromOther){const b=B.get(); if(!isNaN(b))A.set(L-b-sp);} else {const a=A.get(); if(!isNaN(a))B.set(L-a-sp);} };
    sw.onclick=()=>{fromOther=!fromOther;sw.classList.toggle('on',fromOther);A.inp.readOnly=fromOther;B.inp.readOnly=!fromOther;(fromOther?B:A).inp.focus();};
    A.inp.oninput=sync; B.inp.oninput=sync; if(G)G.inp.oninput=sync;
    box.append(h('div',{class:'hint'},`${nWin(n)} по ${fmtU(w)} в один ряд. Опорная сторона — ${info.horiz?'левый':'верхний'} конец стены, длина стены ${fmtU(L)}.`),A.row);
    if(G)box.append(G.row); box.append(S.row,B.row,sw);
    api.buttons=[{label:'Отмена',cancel:true,onClick:a=>a.close(null)},{label:'ОК',primary:true,onClick:a=>{
      const g=gapNow(); if(G&&isNaN(g))return a.err('Введите простенок'); if(g!=null&&g<0)return a.err('Простенок не может быть меньше 0');
      const sp=span(); const st=fromOther?(L-B.get()-sp):A.get(); if(isNaN(st))return a.err('Введите значение');
      if(st<-0.5||st+sp>L+0.5)return a.err(`Ряд шириной ${fmtU(Math.round(sp))} не помещается: допустимо 0 … ${fmtU(Math.max(0,Math.round(L-sp)))} от стены`);
      const offs=g==null?row.map(q=>Math.round(st+q.offset-row[0].offset)):gapOffsets(st,n,w,g);
      for(const q of wallOpenings(row[0].wallId)){ if(ids.has(q.id))continue; if(offs.some(o=>o<q.offset+q.width-0.5&&q.offset<o+w-0.5)) return a.err(`Мешает ${q.name} (${fmtU(q.offset)}…${fmtU(q.offset+q.width)}).`); }
      a.close({start:Math.round(st),gap:g});}}];
  });
}
