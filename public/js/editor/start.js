'use strict';
/* furnitech · редактор · start.js
   Первый шаг на пустом плане: карточка «С чего начнём?» и построение комнаты по размерам (прямоугольной или Г‑образной).
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */

/* Контур комнаты по размерам, мм. Размеры — внутренние (по полу): точки контура лежат на внутренней стороне стен.
   Г‑образная: из прямоугольника w×l вырезан угол cw×cl (правый верхний). → [[x, y], …] по часовой стрелке */
function roomTemplatePoints(shape,w,l,cw,cl){
  if(shape==='L')return [[0,0],[w-cw,0],[w-cw,cl],[w,cl],[w,l],[0,l]];
  return [[0,0],[w,0],[w,l],[0,l]];
}
async function roomTemplateDialog(){
  return dialog((box,api)=>{
    box.classList.add('mid');box.append(h('h3',{},'Комната по размерам'),h('div',{class:'hint'},'Размеры — внутренние, по полу. Стены, двери и окна потом можно поправить на плане.'));
    let shape='rect';
    const U=unitRow();box.append(U.row);
    const seg=h('div',{class:'seg',role:'group','aria-label':'Форма комнаты'});
    [['rect','Прямоугольная'],['L','Г‑образная']].forEach(([k,nm])=>seg.append(h('button',{type:'button','data-k':k,class:k===shape?'on':'','aria-pressed':String(k===shape),onclick:()=>{shape=k;[...seg.children].forEach(b=>{b.classList.toggle('on',b.dataset.k===k);b.setAttribute('aria-pressed',String(b.dataset.k===k));});sync();}},nm)));
    box.append(h('div',{class:'f'},h('label',{},'Форма'),seg));
    const W=numRow('Ширина',4000),L=numRow('Длина',3000),CW=numRow('Ширина выреза',1500),CL=numRow('Длина выреза',1200),H=numRow('Высота потолка',P.wallHeight||DEF.wallH);
    const cv2=h('canvas',{class:'tplprev',width:'240',height:'150','aria-hidden':'true'});
    box.append(W.row,L.row,CW.row,CL.row,H.row,cv2);
    const rows=[W,L,CW,CL,H];
    const read=()=>({w:W.get(),l:L.get(),cw:CW.get(),cl:CL.get(),hv:H.get()});
    const check=(v)=>{
      if([v.w,v.l,v.hv].some(isNaN)||(shape==='L'&&[v.cw,v.cl].some(isNaN)))return 'Введите размеры';
      if(v.w<1000||v.l<1000)return `Ширина и длина — не меньше ${fmtU(1000)}`;
      if(v.w>MAX_WALL||v.l>MAX_WALL)return `Стена не длиннее ${fmtU(MAX_WALL)}`;
      if(v.hv<MIN_H||v.hv>MAX_H)return `Высота: ${fmtU(MIN_H)} … ${fmtU(MAX_H)}`;
      if(shape==='L'){if(v.cw<MIN_WALL||v.cl<MIN_WALL)return `Вырез — не меньше ${fmtU(MIN_WALL)}`;if(v.cw>v.w-MIN_WALL||v.cl>v.l-MIN_WALL)return 'Вырез должен быть меньше комнаты';}
      return null;
    };
    const draw=()=>{const x=cv2.getContext('2d');if(!x)return;const dpr=Math.min(2,window.devicePixelRatio||1),Wp=240,Hp=150;cv2.width=Wp*dpr;cv2.height=Hp*dpr;x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,Wp,Hp);
      const v=read();if(check(v))return;const pts=roomTemplatePoints(shape,v.w,v.l,v.cw,v.cl);const k=Math.min((Wp-24)/v.w,(Hp-24)/v.l),ox=(Wp-v.w*k)/2,oy=(Hp-v.l*k)/2;
      x.beginPath();pts.forEach(([px,py],i)=>i?x.lineTo(ox+px*k,oy+py*k):x.moveTo(ox+px*k,oy+py*k));x.closePath();x.fillStyle=cssv('--muted')||'#f4f4f5';x.fill();x.lineWidth=3;x.lineJoin='round';x.strokeStyle=cssv('--wall')||'#27272a';x.stroke();
      x.fillStyle=cssv('--muted-foreground')||'#71717a';x.font='500 12px '+(cssv('--font')||'sans-serif');x.textAlign='center';x.textBaseline='middle';
      const area=shape==='L'?v.w*v.l-v.cw*v.cl:v.w*v.l;x.fillText(m2(area),Wp/2,shape==='L'?oy+(v.cl+(v.l-v.cl)/2)*k:Hp/2);};
    const sync=()=>{CW.row.hidden=CL.row.hidden=shape!=='L';api.err('');draw();};
    rows.forEach(r=>{r.inp.addEventListener('input',()=>{api.err('');draw();});});
    U.sel.onchange=()=>{const v=rows.map(r=>r.get());P.unit=U.sel.value;$('#unitSel').value=P.unit;rows.forEach((r,i)=>{if(!isNaN(v[i]))r.inp.value=fmt(v[i]);r.unitSpan.textContent=UNITS[P.unit].l;});draw();};
    api.buttons=[{label:'Отмена',cancel:true,onClick:a=>a.close(null)},{label:'Построить комнату',primary:true,onClick:a=>{const v=read();const e=check(v);if(e)return a.err(e);a.close({shape,...v});}}];
    api.setup=sync;
  });
}
/* Построить комнату по шаблону. Работает только на пустом плане: готовый контур шаблоном не заменяется. */
async function startFromTemplate(){
  if(READONLY){toast(READONLY_MSG);return;}
  if(P.vertices.length){toast('Шаблон ставится на пустой план. Очистите проект в меню, чтобы начать заново',true);return;}
  const r=await roomTemplateDialog();if(!r)return;
  const pts=roomTemplatePoints(r.shape,Math.round(r.w),Math.round(r.l),Math.round(r.cw),Math.round(r.cl));
  const err=apply(Q=>{
    Q.vertices=pts.map(([x,y])=>({id:uid(),x,y}));
    Q.walls=Q.vertices.map((v,i)=>({id:uid(),a:v.id,b:Q.vertices[(i+1)%Q.vertices.length].id}));
    Q.wallHeight=Math.round(r.hv);Q.wallParamsSet=true;
  });
  if(err){toast(err,true);return;}
  E.tool='select';E.mode='idle';updateTools();fitRoom();
  toast('Комната построена. Добавьте двери и окна, затем переходите к мебели');
}

/* ---------- стартовая карточка ---------- */
/* Показывается, пока на плане нет ни одной точки и пользователь ничего не начал. «Нарисовать самому» прячет её до конца сеанса:
   если после этого отменить рисование, план останется пустым, но карточка не будет мешать. */
let START_DISMISSED=false;
function updateEmptyState(){
  const main=$('main');if(!main)return;
  let el=$('#startCard');
  const res=$('#result');
  const show=!READONLY&&!START_DISMISSED&&P.mode==='walls'&&!P.vertices.length&&E.mode==='idle'&&E.tool==='select'&&!T3.active&&!(res&&!res.hidden);
  document.body.classList.toggle('empty-start',show);
  if(!show){if(el)el.hidden=true;return;}
  if(!el){
    el=h('div',{id:'startCard',role:'region','aria-label':'С чего начать'},
      h('h3',{},'С чего начнём?'),
      h('p',{},'Постройте комнату по своим размерам за пару секунд или нарисуйте стены сами — стена за стеной.'),
      h('div',{class:'sc-btns'},
        h('button',{type:'button',class:'primary',onclick:startFromTemplate},ic('maximize'),'Комната по размерам'),
        h('button',{type:'button',onclick:()=>{START_DISMISSED=true;setTool('wall');}},ic('wall'),'Нарисовать стены')),
      h('ol',{class:'sc-steps'},h('li',{},'Стены'),h('li',{},'Двери и окна'),h('li',{},'Мебель из каталога'),h('li',{},'Прогулка в 3D и подбор с ИИ')));
    main.append(el);
  }
  el.hidden=false;
}
