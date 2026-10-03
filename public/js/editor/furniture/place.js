'use strict';
/* furnitech · редактор · furniture/place.js
   Размещение и перемещение мебели, операции, режимы, виджет, размеры, 3D‑модели мебели.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ---------- Размещение ---------- */
function computeFGhost(cw){
  const it=E.fPlace; if(!it)return null; const t=TYPE.get(it.typeId),fo=formOf(t,it.formId),mt=mountOf(t,fo); const f=Object.assign({},it,{x:cw.x,y:cw.y,rot:E.fRot,mirror:E.fMirror});
  if(mt==='wall'){const i=nearestWall(cw);if(!i)return {item:f,invalid:'Наведите на стену'};if(i.len<f.dims.W)return {item:f,invalid:'Стена короче предмета'};const proj=dot(sub(cw,i.ref),{x:i.rx,y:i.ry});let off=Math.max(0,Math.min(i.len-f.dims.W,proj-f.dims.W/2));f.wallId=i.w.id;f.offset=Math.round(off);f.elev=f.dims.E??0;const fr=furniturePlacementFrame(f);Object.assign(f,{x:fr.x,y:fr.y,rot:fr.rot});return finishGhost(f);}
  if(mt==='ontop'){const base=(P.furniture||[]).filter(b=>TYPE.get(b.typeId).base&&b.id!==f.id).find(b=>pointInPoly(cw,fWorldOf(b,P,D)||[]));if(!base)return {item:f,invalid:'Нужно основание (стол, тумба…)'};const bb=aabbOf(fWorldOf(base,P,D));const la=aabbOf(fWorld(f));f.x=Math.max(bb.x0+la.w/2,Math.min(bb.x1-la.w/2,cw.x));f.y=Math.max(bb.y0+la.h/2,Math.min(bb.y1-la.h/2,cw.y));f.baseId=base.id;if(la.w>bb.w+1||la.h>bb.h+1)return {item:f,invalid:'Не помещается на основании'};return finishGhost(f);}
  if((mt==='floor')&&!E.alt){ // привязка тылом к стене + угол
    const l=fLocal(f); let i=null,bd=Infinity; for(const w of P.walls){const wi=D.W.get(w.id);const dd=distPtSeg(cw,wi.a,wi.b);if(dd<bd){bd=dd;i=wi;}}
    if(i&&bd<l.h/2+SNAP_R/vp().zoom+50){const rot=Math.atan2(i.nx,-i.ny)*180/Math.PI;f.rot=rot;const back=l.h/2;const proj=dot(sub(cw,i.a),{x:i.ux,y:i.uy});let tt=Math.max(l.w/2,Math.min(i.len-l.w/2,proj));const sn=SNAP_R/vp().zoom;if(proj<l.w/2+sn)tt=l.w/2;if(proj>i.len-l.w/2-sn)tt=i.len-l.w/2;f.x=i.a.x+i.ux*tt-i.nx*back;f.y=i.a.y+i.uy*tt-i.ny*back;}
  }
  return finishGhost(f);
}
function finishGhost(f){
  const Q=Object.assign({},P,{furniture:[...(P.furniture||[]).filter(x=>x.id!==f.id),f],mode:'furniture',_strict:[f.id]}); const err=validateFurniture(Q,D);
  f.warnings=furnitureWarnings(f,Q,D).filter(w=>w!=='outside');
  return {item:f,invalid:err?err.replace(/^[^:]+: /,''):null};
}
async function placeFurnitureClick(cw){
  const g=computeFGhost(cw); if(!g||g.invalid){if(g)toast(g.invalid,true);return;}
  const f=g.item; const t=TYPE.get(f.typeId);
  const err=apply(Q=>{Q.furniture=Q.furniture||[];Q.furniture.push(f);Q.fseq=Q.fseq||{};if(!f.productId)Q.fseq[t.id]=(Q.fseq[t.id]||0)+1;},{noHist:true}); if(err)return toast(err,true);
  E.sel={type:'furniture',id:f.id}; E.activeDim={type:'furniture',id:f.id}; render();
  const r=await fPositionDialog(P.furniture.find(x=>x.id===f.id)); E.activeDim=null;
  if(!r){apply(Q=>{Q.furniture=Q.furniture.filter(x=>x.id!==f.id);if(!f.productId)Q.fseq[t.id]--;},{noHist:true});E.sel=null;}
  else{const e2=apply(Q=>{Object.assign(Q.furniture.find(x=>x.id===f.id),r);refreshWarnings(Q);Q._strict=[f.id];});if(e2)toast(e2,true);}
  E.mode='idle';E.fPlace=null;E.fGhost=null;E.tool='select';updateTools();render();
}
function refreshWarnings(Q){const d=derive(Q);(Q.furniture||[]).forEach(f=>{f.warnings=furnitureWarnings(f,Q,d);});}
function rayToWall(from,dir,p=P,d=D){let best=null;for(const w of p.walls){const i=d.W.get(w.id);const r=lineInter(from,dir,i.a,{x:i.ux,y:i.uy});if(!r)continue;const t=(r.x-from.x)*dir.x+(r.y-from.y)*dir.y;if(t<-0.5)continue;const s=dot(sub(r,i.a),{x:i.ux,y:i.uy});if(s<-0.5||s>i.len+0.5)continue;if(!best||t<best.t)best={t,wallId:w.id,pt:r};}return best;}
function fDistances(f,p=P,d=D){const pts=fWorldOf(f,p,d);if(!pts)return null;const a=aabbOf(pts);return {a,left:rayToWall({x:a.x0,y:a.cy},{x:-1,y:0},p,d),right:rayToWall({x:a.x1,y:a.cy},{x:1,y:0},p,d),top:rayToWall({x:a.cx,y:a.y0},{x:0,y:-1},p,d),bottom:rayToWall({x:a.cx,y:a.y1},{x:0,y:1},p,d)};}
async function fPositionDialog(f){
  const t=TYPE.get(f.typeId),fo=formOf(t,f.formId),mt=mountOf(t,fo);
  if(mt==='wall'){const i=D.W.get(f.wallId);const L=i.len;return dialog((box,api)=>{box.append(h('h3',{},`Положение: ${f.name}`));const A=numRow('От стены (опорной)',f.offset),Wr=numRow('Ширина',f.dims.W,{readonly:true}),B=numRow('До другой стены',L-f.offset-f.dims.W,{readonly:true}),Er=numRow('От пола',f.elev??0);A.inp.oninput=()=>{const a=A.get();if(!isNaN(a))B.inp.value=fmt(L-a-f.dims.W);};box.append(A.row,Wr.row,B.row,Er.row);
    api.buttons=[{label:'Отмена',cancel:true,onClick:a=>a.close(null)},{label:'ОК',primary:true,onClick:a=>{const off=A.get(),el=Er.get();if(isNaN(off)||isNaN(el))return a.err('Введите значения');if(off<0||off>L-f.dims.W+0.5)return a.err(`Допустимо: 0 … ${fmtU(L-f.dims.W)}`);if(el<0||el+f.dims.H>P.wallHeight+0.5)return a.err(`Высота: 0 … ${fmtU(P.wallHeight-f.dims.H)}`);a.close({offset:Math.round(off),elev:Math.round(el)});}}];});}
  const ds=fDistances(f); if(!ds)return null;
  return dialog((box,api)=>{
    box.append(h('h3',{},`Положение: ${f.name}`));
    const mkAxis=(lbl,near,far,nearName,farName)=>{let side=(near&&far)?(near.t<=far.t?'near':'far'):(near?'near':'far');const sel=h('select',{},h('option',{value:'near'},nearName),h('option',{value:'far'},farName));sel.value=side;const inp=h('input',{type:'text',inputmode:'decimal'});const other=h('input',{type:'text',readonly:''});
      const cur=()=>side==='near'?near:far,oth=()=>side==='near'?far:near;const refresh=()=>{inp.value=cur()?fmt(Math.round(cur().t)):'';other.value=oth()?fmt(Math.round(oth().t)):'—';inp.disabled=!cur();};
      sel.onchange=()=>{side=sel.value;refresh();};inp.oninput=()=>{const v=parseLen(inp.value);if(!isNaN(v)&&cur()&&oth())other.value=fmt(Math.round(oth().t+cur().t-v));};refresh();
      const row=h('div',{class:'f'},h('label',{},lbl,' ',sel),h('div',{class:'val'},inp,h('span',{},UNITS[P.unit].l)));const row2=h('div',{class:'f'},h('label',{},'→ до другой'),h('div',{class:'val'},other,h('span',{},UNITS[P.unit].l)));
      return {row,row2,get:()=>({side,v:parseLen(inp.value),cur:cur()})};};
    const hx=mkAxis('Горизонталь',ds.left,ds.right,'слева','справа'),vy=mkAxis('Вертикаль',ds.top,ds.bottom,'сверху','снизу');
    box.append(hx.row,hx.row2,vy.row,vy.row2,h('div',{class:'hint'},'Расстояние от габарита предмета до ближайшей стены по оси.'));
    api.buttons=[{label:'Отмена',cancel:true,onClick:a=>a.close(null)},{label:'ОК',primary:true,onClick:a=>{const X=hx.get(),Y=vy.get();if(isNaN(X.v)||isNaN(Y.v))return a.err('Введите значения');if(X.v<0||Y.v<0)return a.err('Расстояние не может быть отрицательным');
      let dx=0,dy=0;if(X.cur)dx=(X.side==='near'?-1:1)*(X.v-X.cur.t);if(Y.cur)dy=(Y.side==='near'?-1:1)*(Y.v-Y.cur.t);
      const Q=JSON.parse(JSON.stringify(P));const q=Q.furniture.find(x=>x.id===f.id);q.x=Math.round(f.x+dx);q.y=Math.round(f.y+dy);Q._strict=[f.id];const err=validateFurniture(Q,derive(Q));if(err)return a.err(err);a.close({x:q.x,y:q.y});}}];
  });
}
function beginFDrag(f,sp){if(READONLY||P.mode!=='furniture')return false;if(f.locked){toast('Объект зафиксирован. Снимите замок (L)');cv.style.cursor='not-allowed';return false;}const t=TYPE.get(f.typeId),fo=formOf(t,f.formId),mt=mountOf(t,fo);const cw=Wd(sp);E.drag={type:'furniture',id:f.id,orig:JSON.parse(JSON.stringify(f)),grab:mt==='wall'?null:{x:cw.x-f.x,y:cw.y-f.y}};E.activeDim={type:'furniture',id:f.id};return true;}
function updateFDrag(sp){const f=P.furniture.find(x=>x.id===E.drag.id);const cw=Wd(sp);E.fPlace=f;E.fRot=f.rot;E.fMirror=f.mirror;const g=computeFGhost(E.drag.grab?{x:cw.x-E.drag.grab.x,y:cw.y-E.drag.grab.y}:cw);E.fPlace=null;if(g){Object.assign(f,{x:g.item.x,y:g.item.y,rot:g.item.rot,wallId:g.item.wallId??f.wallId,offset:g.item.offset??f.offset,baseId:g.item.baseId??f.baseId});E.dragInvalid=g.invalid;}render();}
async function endFDrag(){const dr=E.drag;E.drag=null;const f=P.furniture.find(x=>x.id===dr.id);const moved=JSON.parse(JSON.stringify(f));Object.assign(f,dr.orig);const tmp=Object.assign({},f,moved);const r=await fPositionDialog(tmp);E.activeDim=null;if(r){const err=apply(Q=>{const q=Q.furniture.find(x=>x.id===f.id);Object.assign(q,moved,r);refreshWarnings(Q);Q._strict=[f.id];});if(err)toast(err,true);}render();}

/* ---------- Операции над мебелью ---------- */
function fUpdate(id,fn){return apply(Q=>{const q=Q.furniture.find(x=>x.id===id);if(!q)return 'Предмет не найден';if(q.locked)return 'Объект зафиксирован. Снимите замок (L)';fn(q,Q);refreshWarnings(Q);Q._strict=[id];});}
function deleteFurniture(id){const f=P.furniture.find(x=>x.id===id);if(!f)return;if(f.locked){toast('Объект зафиксирован. Снимите замок (L)',true);return;}const err=apply(Q=>{Q.furniture=Q.furniture.filter(x=>x.id!==id&&x.baseId!==id);});if(err)toast(err,true);else E.sel=null;render();}
function copyFurniture(f){const t=TYPE.get(f.typeId);const c=makeFurniture(t,f.formId,f.constraints,f.productId?PRODUCTS.find(p=>p.id===f.productId):null,f.formAny);c.dims=Object.assign({},f.dims);beginPlace(c);}
async function replaceFurniture(f){const t=TYPE.get(f.typeId);let cons=f.constraints;if(f.productId){cons={};const fo=formOf(t,f.formId);for(const k of [...fo.dims,'H'])cons[k]={mode:'range',min:Math.round(f.dims[k]*0.85),max:Math.round(f.dims[k]*1.15)};}
  const r=await productDialog(t,f.formId,cons,{noPlaceholder:!f.productId});if(!r||r.back)return;
  const err=fUpdate(f.id,(q,Q)=>{if(r.placeholder){q.productId=null;q.formAny=false;q.name=`${t.name} ${(Q.fseq[t.id]||0)+1}`;Q.fseq[t.id]=(Q.fseq[t.id]||0)+1;}else{q.productId=r.product.id;q.formAny=false;q.name=r.product.name;q.formId=r.product.formId;q.dims=Object.assign({},r.product.dims);}});if(err)toast('Замена невозможна: '+err,true);}
function toggleLock(sel){
  if(!sel)return; let err=null;
  if(sel.type==='wall')err=apply(Q=>{const w=Q.walls.find(x=>x.id===sel.id);w.locked=!w.locked;});
  else if(sel.type==='opening')err=apply(Q=>{const o=Q.openings.find(x=>x.id===sel.id);o.locked=!o.locked;});
  else if(sel.type==='furniture')err=apply(Q=>{const f=Q.furniture.find(x=>x.id===sel.id);f.locked=!f.locked;});
  else toast('Этот объект не запирается');
  if(err)toast(err,true);
}
function lockAll(v){const err=apply(Q=>{if(Q.mode==='furniture')(Q.furniture||[]).forEach(f=>f.locked=v);else{Q.walls.forEach(w=>w.locked=v);Q.openings.forEach(o=>o.locked=v);}});if(err)toast(err,true);else toast(v?'Всё заперто':'Всё отперто');}
function isLocked(sel){if(!sel)return false;if(sel.type==='wall')return !!P.walls.find(x=>x.id===sel.id)?.locked;if(sel.type==='opening')return !!P.openings.find(x=>x.id===sel.id)?.locked;if(sel.type==='furniture')return !!P.furniture?.find(x=>x.id===sel.id)?.locked;return false;}

/* ---------- Режимы ---------- */
function setMode(m){
  if(m==='furniture'&&!P.closed){toast('Сначала замкните контур комнаты',true);return;}
  if(E.mode==='fPlace'){E.fPlace=null;E.fGhost=null;} E.mode='idle';E.tool='select';E.sel=null;E.copyMode=false;
  const err=apply(Q=>{Q.mode=m;refreshWarnings(Q);},{noHist:true}); if(err)toast(err,true);
  updateModeUI();
  if(m==='furniture'){const bad=(P.furniture||[]).filter(f=>f.warnings?.includes('outside'));if(bad.length)toast('Вне комнаты: '+bad.map(f=>f.name).join(', '),true);buildCatalog();}
  render();
}
function updateModeUI(){const fm=P.mode==='furniture';document.body.classList.toggle('fm',fm);if(!fm)setCatalogOpen(false);$('#modeWalls').setAttribute('aria-pressed',String(!fm));$('#modeFurn').setAttribute('aria-pressed',String(fm));$('#tools').hidden=fm||T3.active;$('#catalog').hidden=!fm||T3.active;$('#modeWalls').classList.toggle('on',!fm);$('#modeFurn').classList.toggle('on',fm);$('#modeFurn').disabled=!P.closed;$('#modeFurn').title=P.closed?'':'Сначала замкните контур комнаты';$('#btnFinish').hidden=!fm;$('#btnFinish').disabled=!(P.furniture||[]).length;$('#btnFinish').title=(P.furniture||[]).length?'':'Расставьте хотя бы один предмет или пустышку';updateLockBtn();}

/* ---------- Виджет мебели ---------- */
function furnitureWidget(wg,f){
  const t=TYPE.get(f.typeId),fo=formOf(t,f.formId),mt=mountOf(t,fo);const ro=f.locked;
  const row=(lbl,val,onSet,readonly)=>{const inp=h('input',{type:'text',value:fmt(val)});if(readonly||ro)inp.readOnly=true;else inp.onchange=()=>{const v=parseLen(inp.value);if(isNaN(v)){toast('Введите число',true);inp.value=fmt(val);return;}const err=onSet(v);if(err){toast(err,true);inp.value=fmt(val);}};return h('div',{class:'row'},h('span',{},lbl),inp);};
  wg.append(h('h4',{},f.name,h('button',{type:'button',class:'lk','aria-label':'Зафиксировать положение',title:'Зафиксировать положение (L)',onclick:()=>toggleLock({type:'furniture',id:f.id})},lockIcon(f.locked))));
  wg.append(h('div',{class:'row'},h('span',{},f.productId?'Товар':'Пустышка'),h('span',{},fo.name)));
  for(const k of [...fo.dims,'H'])wg.append(row((k==='DIA'?'Ø ':'')+DIMN[k],f.dims[k],(v)=>fUpdate(f.id,q=>{q.dims[k]=v;q.constraints[k]={mode:'exact',exact:v};}),!!f.productId));
  if(mt==='wall')wg.append(row('От пола',f.elev??0,(v)=>fUpdate(f.id,q=>{q.elev=v;})));
  else{const rin=h('input',{type:'text',value:String(f.rot)});rin.readOnly=ro;rin.onchange=()=>{const v=Number(rin.value);if(!isFinite(v)){rin.value=f.rot;return;}const err=fUpdate(f.id,q=>{q.rot=((v%360)+360)%360;});if(err){toast(err,true);rin.value=f.rot;}};wg.append(h('div',{class:'row'},h('span',{},'Поворот, °'),rin));}
  if(f.warnings?.length)wg.append(h('div',{class:'row warn'},ic('alert'),h('span',{},f.warnings.map(w=>({outside:'вне комнаты',door:'мешает двери',window:'перед окном'})[w]).join(', '))));
  const acts=h('div',{class:'acts'});
  acts.append(h('button',{disabled:ro?'':null,onclick:()=>{const err=fUpdate(f.id,q=>{q.mirror=!q.mirror;});if(err)toast(err,true);}},'Зеркало'),h('button',{disabled:ro?'':null,onclick:()=>replaceFurniture(f)},'Заменить'),h('button',{onclick:()=>copyFurniture(f)},'Копировать'));
  const acts2=h('div',{class:'acts'});
  if(f.productId)acts2.append(h('button',{disabled:ro?'':null,onclick:()=>{const err=fUpdate(f.id,(q,Q)=>{q.productId=null;q.formAny=false;q.name=`${t.name} ${(Q.fseq[t.id]||0)+1}`;Q.fseq[t.id]=(Q.fseq[t.id]||0)+1;for(const k in q.dims)q.constraints[k]={mode:'exact',exact:q.dims[k]};});if(err)toast(err,true);}},'Сделать пустышкой'));
  acts2.append(h('button',{class:'del',disabled:ro?'':null,onclick:()=>deleteFurniture(f.id)},'Удалить'));
  wg.append(acts,acts2);
  [...wg.querySelectorAll('button[disabled=""]')].forEach(b=>{b.disabled=true;});
}

/* ---------- Размеры мебели ---------- */
function collectFurnitureDims(items){
  const showAll=P.showDims; const list=[]; if(showAll)(P.furniture||[]).forEach(f=>list.push(f)); if(E.sel?.type==='furniture'){const f=P.furniture.find(x=>x.id===E.sel.id);if(f&&!list.includes(f))list.push(f);} if(E.drag?.type==='furniture'){const f=P.furniture.find(x=>x.id===E.drag.id);if(f&&!list.includes(f))list.push(f);}
  for(const f of list){const ds=fDistances(f);if(!ds)continue;const a=ds.a;const act=(E.activeDim?.type==='furniture'&&E.activeDim.id===f.id)||E.drag?.id===f.id;const mk=(p1,p2,n,text)=>({kind:'fchain',fid:f.id,p1,p2,n,text,active:act,level:1,len:hyp(sub(p2,p1))});
    const ny={x:0,y:1},nx={x:1,y:0};
    if(ds.left)items.push(mk({x:ds.left.pt.x,y:a.y1},{x:a.x0,y:a.y1},ny,fmt(Math.round(ds.left.t))));items.push(mk({x:a.x0,y:a.y1},{x:a.x1,y:a.y1},ny,fmt(Math.round(a.w))));if(ds.right)items.push(mk({x:a.x1,y:a.y1},{x:ds.right.pt.x,y:a.y1},ny,fmt(Math.round(ds.right.t))));
    if(ds.top)items.push(mk({x:a.x1,y:ds.top.pt.y},{x:a.x1,y:a.y0},nx,fmt(Math.round(ds.top.t))));items.push(mk({x:a.x1,y:a.y0},{x:a.x1,y:a.y1},nx,fmt(Math.round(a.h))));if(ds.bottom)items.push(mk({x:a.x1,y:a.y1},{x:a.x1,y:ds.bottom.pt.y},nx,fmt(Math.round(ds.bottom.t))));}
}

/* ---------- 3D мебель ---------- */
const GLB_CACHE=new Map();
function glbFor(url){let c=GLB_CACHE.get(url);if(c)return c;c={state:'loading',scene:null};GLB_CACHE.set(url,c);
  if(typeof THREE!=='undefined'&&THREE.GLTFLoader){try{new THREE.GLTFLoader().load(url,g=>{c.state='ready';c.scene=g.scene;T3.dirty=true;},undefined,()=>{c.state='error';});}catch(e){c.state='error';}}else c.state='error';return c;}
/* Модель товара (glTF: Y вверх, метры, перед по +Z) вписывается в габарит предмета w×H×d и ставится на пол по центру футпринта */
function productModel3D(f,wM,hM,dM){const pr=f.productId&&PRODUCT_BY_ID.get(f.productId);if(!pr||!pr.model||!pr.model.url)return null;const c=glbFor(pr.model.url);if(c.state!=='ready')return null;
  const m=c.scene.clone(true);const box=new THREE.Box3().setFromObject(m);const sz=new THREE.Vector3();box.getSize(sz);if(sz.x<=0||sz.y<=0||sz.z<=0)return null;
  const wrap=new THREE.Group();m.scale.set(wM/sz.x,hM/sz.y,dM/sz.z);const ctr=new THREE.Vector3();box.getCenter(ctr);m.position.set(-ctr.x*m.scale.x,-box.min.y*m.scale.y,-ctr.z*m.scale.z);wrap.add(m);return wrap;}
function buildFurniture3D(group){
  const H=P.wallHeight/1000; const items=P.furniture||[];
  for(const f of items){const t=TYPE.get(f.typeId),fo=formOf(t,f.formId),mt=mountOf(t,fo);const fr=furniturePlacementFrame(f);if(!fr)continue;const l=fpPoly(fo.fp,f.dims);const hgt=(f.dims.H||500)/1000;
    const shape=new THREE.Shape(l.pts.map(p=>new THREE.Vector2(p.x/1000,-p.y/1000)));const geo=new THREE.ExtrudeGeometry(shape,{depth:hgt,bevelEnabled:false});
    const ph=!f.productId;const mat=new THREE.MeshStandardMaterial({color:ph?'#6ea0ec':colorFor(t),roughness:0.7,transparent:ph,opacity:ph?0.35:1,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(geo,mat);mesh.rotation.x=-Math.PI/2;const g=new THREE.Group();g.add(mesh);
    const model=productModel3D(f,l.w/1000,hgt,l.h/1000);if(model){mesh.visible=false;g.add(model);}
    let y=0;if(mt==='wall')y=(f.elev??0)/1000;else if(mt==='ceiling')y=H-hgt;else if(mt==='ontop'){const b=items.find(x=>x.id===f.baseId);y=b?(b.dims.H||500)/1000:0;}
    g.position.set(fr.x/1000,y,fr.y/1000);g.rotation.y=-fr.rot*Math.PI/180;g.scale.x=fr.mirror?-1:1;g.userData={type:'furniture',id:f.id};
    const lab=textSprite((ph?'? ':'')+f.name);lab.position.set(0,hgt+0.15,0);g.add(lab);
    group.add(g);T3.pickables.push(mesh);mesh.userData={type:'furniture',id:f.id};
    if(f.locked){const lk=textSprite('зафиксирован');lk.position.set(0,hgt+0.35,0);g.add(lk);}
  }
}
function colorFor(t){const m={living:'#b98a58',bedroom:'#c9b8a0',kids:'#9fc7ad',kitchen:'#c9c9c4',dining:'#a97c50',bath:'#dfe8f8',toilet:'#dfe8f8',hall:'#b0ada4',office:'#8f9aa8',closet:'#c9c2b6',balcony:'#9fc7ad',tech:'#6b6f76',light:'#f7e1c8',decor:'#d9a877'};return m[t.cats[0]]||'#aaaaaa';}
function textSprite(text){const c=document.createElement('canvas');c.width=256;c.height=64;const x=c.getContext('2d');x.fillStyle='rgba(20,22,26,.65)';x.fillRect(0,0,256,64);x.fillStyle='#fff';x.font='28px sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText(text.slice(0,22),128,32);const tex=new THREE.CanvasTexture(c);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));sp.scale.set(0.8,0.2,1);return sp;}
function openFurnitureCard(f){const pn=$('#matPanel');pn.hidden=false;document.body.classList.add('mat-open');pn.innerHTML='';T3.panelTarget=null;const t=TYPE.get(f.typeId),fo=formOf(t,f.formId);pn.classList.toggle('collapsed',!!P.panelCollapsed);pn.append(h('h4',{},h('button',{type:'button',class:'coll','aria-label':'Свернуть или развернуть панель',title:'Свернуть/развернуть',onclick:toggleMatPanel},ic('chevron-right')),h('span',{style:'flex:1'},f.name),h('button',{type:'button',class:'x','aria-label':'Закрыть панель',onclick:()=>selectIn3D(null)},ic('close'))));pn.append(h('div',{class:'row'},h('span',{},f.productId?'Товар':'Пустышка'),h('span',{},fo.name)));for(const k of [...fo.dims,'H'])pn.append(h('div',{class:'row'},h('span',{},DIMN[k]),h('span',{},fmtU(f.dims[k]))));pn.append(h('div',{class:'foot'},h('button',{onclick:()=>{toggleLock({type:'furniture',id:f.id});}},lockIcon(!f.locked),f.locked?'Отпереть':'Зафиксировать'),h('button',{onclick:()=>{exit3D();setMode('furniture');E.sel={type:'furniture',id:f.id};render();}},'В плане')));}
