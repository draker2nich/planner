'use strict';
/* furnitech · редактор · render.js
   Визуализация комнаты: кадр из 3D‑вида → фотореалистичная картинка от модели изображений (сервер — server/core/renders.js).
   Путь пользователя: «Визуализация» в 3D → выбрать ракурс (свой текущий вид или предложенный из угла комнаты) → первая картинка →
   «Ещё ракурс в этом стиле»: следующие кадры рисуются по образцу готовой картинки, чтобы комната на всех выглядела одинаково.
   Кадр снимается отдельно от экрана: фиксированный размер 3:2, без подписей, стрелок и пустышек; в запрос идут только кадр,
   описание сцены значениями из словарей и фото товаров каталога — свободного текста пользователя в запросе нет.
   Готовые картинки принадлежат проекту аккаунта и хранятся на сервере; гость по ссылке и поддержка их только смотрят.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
ICONS.camera='<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>';
ICONS.download='<path d="M12 4v11M7 11l5 5 5-5M4 20h16"/>';

const RND={W:1536,H:1024,ASPECT:'3:2',busy:false,list:[],info:null,urls:new Map()};

/* ---------- сервер ---------- */
/* Откуда берутся визуализации: свой проект в аккаунте, проект по ссылке владельца или просмотр поддержкой. null — взять неоткуда. */
function renderSource(){
  const S0=window.EditorSync||{};
  if(S0.mode==='view'){
    if(S0.view&&S0.view.share)return {path:'/shared/'+S0.view.share+'/renders',token:null,own:false};
    if(S0.view&&S0.view.id){let tok=null;try{tok=localStorage.getItem('admin.token');}catch(e){}return {path:'/admin/projects/'+encodeURIComponent(S0.view.id)+'/renders',token:tok,own:false};}
    return null;
  }
  return S0.mode==='account'&&S0.id?{path:'/projects/'+S0.id+'/renders',own:true}:null;
}
async function renderApi(src,method,sub,body){
  if(src.own)return Session.api(method,src.path+(sub||''),body);
  const r=await fetch('/api'+src.path+(sub||''),{method,headers:Object.assign({Accept:'application/json'},src.token?{Authorization:'Bearer '+src.token}:{})});
  let j=null;try{j=await r.json();}catch(e){}
  if(!r.ok){const er=new Error((j&&j.error&&j.error.message)||'Ошибка сервера ('+r.status+')');er.status=r.status;throw er;}
  return j;
}
/* Копии картинок в браузере: галерея не скачивает их заново при каждом открытии. Только для своих проектов. */
const RND_DB={db:null,
  open(){if(this.db)return Promise.resolve(this.db);return new Promise((res,rej)=>{const r=indexedDB.open('roomEditor.renders',1);r.onupgradeneeded=()=>r.result.createObjectStore('images',{keyPath:'id'});r.onsuccess=()=>{this.db=r.result;res(this.db);};r.onerror=()=>rej(r.error);});},
  tx(mode,fn){return this.open().then(db=>new Promise((res,rej)=>{const rq=fn(db.transaction('images',mode).objectStore('images'));rq.onsuccess=()=>res(rq.result);rq.onerror=()=>rej(rq.error);}));},
  get(id){return this.tx('readonly',s=>s.get(id));},del(id){return this.tx('readwrite',s=>s.delete(id));},
  /* хранится не больше 40 картинок: самые давние уходят */
  async put(rec){await this.tx('readwrite',s=>s.put(rec));const all=await this.tx('readonly',s=>s.getAll());all.sort((a,b)=>(b.at||0)-(a.at||0));for(const r of all.slice(40))await this.del(r.id);}};
/* → Promise(адрес картинки для <img> | null) */
function renderImageUrl(src,id){
  if(RND.urls.has(id))return RND.urls.get(id);
  const pr=(async()=>{
    let blob=null;
    if(src.own){try{const rec=await RND_DB.get(id);if(rec&&rec.blob)blob=rec.blob;}catch(e){}}
    if(!blob){
      const j=await renderApi(src,'GET','/'+encodeURIComponent(id));
      const bin=atob(j.data),u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
      blob=new Blob([u8],{type:j.mime});
      if(src.own)RND_DB.put({id,blob,at:Date.now()}).catch(()=>{});
    }
    return URL.createObjectURL(blob);
  })().catch(()=>{RND.urls.delete(id);return null;});
  RND.urls.set(id,pr);return pr;
}
function renderForget(id){const p=RND.urls.get(id);RND.urls.delete(id);if(p)p.then(u=>{if(u)URL.revokeObjectURL(u);});RND_DB.del(id).catch(()=>{});}
async function renderLoad(src){
  const j=await renderApi(src,'GET','');
  RND.list=j.renders||[];
  RND.info={enabled:!!j.enabled,mock:!!j.mock,refs:j.refs||0,limit:j.limit||12,daily:j.daily||{limit:0,left:null}};
}

/* ---------- кадр ---------- */
/* ракурс v: {x, y — точка на плане, мм; eye — высота глаз, мм; yaw, pitch — радианы, как у вида изнутри; fov — вертикальный угол, °} */
function renderCamera(v,aspect){
  const cam=new THREE.PerspectiveCamera(v.fov,aspect,0.05,500);cam.position.set(v.x/1000,v.eye/1000,v.y/1000);
  const cp=Math.cos(v.pitch);cam.lookAt(cam.position.clone().add(new THREE.Vector3(Math.sin(v.yaw)*cp,Math.sin(v.pitch),-Math.cos(v.yaw)*cp)));
  cam.updateMatrixWorld(true);return cam;
}
const renderLoading=()=>{for(const c of GLB_CACHE.values())if(c.state==='loading')return true;return false;};
/* Снимок сцены заданного размера → canvas. Рисуется тем же рендерером, что и 3D‑вид, но своей камерой и в состоянии «изнутри»:
   все стены и потолок на месте, за окном небо. Скрыто всё служебное (подписи, стрелки, рамка выбора) и пустышки: полупрозрачный
   синий объём модель изображений превратила бы во что угодно. Размер холста и видимость возвращаются до того, как браузер покажет кадр. */
function renderCapture(v,w,h){
  if(T3.dirty){T3.dirty=false;rebuildScene();}
  const R=T3.renderer,ratio=R.getPixelRatio(),size=R.getSize(new THREE.Vector2());
  const flipped=[];const vis=(o,on)=>{if(o&&o.visible!==on){o.visible=on;flipped.push(o);}};
  const ph=new Set((P.furniture||[]).filter(f=>!f.productId).map(f=>f.id));
  T3.labels.forEach(sp=>vis(sp,false));T3.arrows.forEach(a=>vis(a,false));vis(T3.outline,false);
  T3.room.children.forEach(g=>{if(g.userData&&g.userData.type==='furniture'&&ph.has(g.userData.id))vis(g,false);});
  T3.wallMeshes.forEach(m=>vis(m,true));vis(T3.ceil,true);vis(T3.ground,true);
  const bg=T3.scene.background,fog=T3.scene.fog?T3.scene.fog.color.getHex():null;
  T3.scene.background=new THREE.Color('#bcd4ea');if(T3.scene.fog)T3.scene.fog.color.set('#bcd4ea');
  const out=document.createElement('canvas');out.width=w;out.height=h;
  try{
    R.setPixelRatio(1);R.setSize(w,h,false);R.shadowMap.needsUpdate=true;
    R.render(T3.scene,renderCamera(v,w/h));
    out.getContext('2d').drawImage(R.domElement,0,0,w,h);
  }finally{
    R.setPixelRatio(ratio);R.setSize(size.x,size.y,false);
    flipped.forEach(o=>{o.visible=!o.visible;});
    T3.scene.background=bg;if(fog!=null)T3.scene.fog.color.setHex(fog);
    R.shadowMap.needsUpdate=true;T3.redraw=true;
  }
  return out;
}
/* Товары, которые видны из ракурса, — по убыванию заметности: [{f, score}]. Предмет считается видимым, если хотя бы одна из трёх
   его точек попадает в кадр и не закрыта стеной (в комнате буквой Г мебель за углом в кадр не попадает, хотя и стоит «перед» камерой). */
function renderVisible(v){
  T3.scene.updateMatrixWorld();
  const cam=renderCamera(v,RND.W/RND.H);cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  const fr=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix,cam.matrixWorldInverse));
  const rc=new THREE.Raycaster(),by=new Map((P.furniture||[]).map(f=>[f.id,f])),out=[];
  const seen=(pt)=>{if(!fr.containsPoint(pt))return false;const d=pt.clone().sub(cam.position),L=d.length();if(L<0.1)return true;rc.set(cam.position,d.divideScalar(L));rc.far=L-0.05;return !rc.intersectObjects(T3.wallMeshes,false).length;};
  for(const g of T3.room.children){
    if(!g.userData||g.userData.type!=='furniture')continue;const f=by.get(g.userData.id);if(!f||!f.productId)continue;
    const b=new THREE.Box3().setFromObject(g);if(b.isEmpty())continue;
    const sz=b.getSize(new THREE.Vector3()),c=b.getCenter(new THREE.Vector3());
    const ax=sz.x>=sz.z?new THREE.Vector3(sz.x*0.3,0,0):new THREE.Vector3(0,0,sz.z*0.3);
    if(![c,c.clone().add(ax),c.clone().sub(ax)].some(seen))continue;
    out.push({f,box:b,score:Math.cbrt(Math.max(1e-6,sz.x*sz.y*sz.z))/Math.max(0.5,c.distanceTo(cam.position))});
  }
  return out.sort((a,b)=>b.score-a.score);
}

/* ---------- ракурсы ---------- */
/* Вид, который сейчас на экране (только «Изнутри»); null — в обзоре снаружи или вне 3D */
function renderCurrentView(){
  if(!T3.active||T3.mode!=='walk')return null;
  const p=T3.lastPos||T3.pos||getViewPoints()[T3.point];if(!p)return null;
  return {name:'Текущий вид',x:p.x,y:p.y,eye:P.eyeHeight,yaw:T3.yaw,pitch:T3.pitch,fov:T3.fov};
}
/* Предложенные ракурсы — как снимает интерьерный фотограф: из углов комнаты и от середины стен, с высоты глаз, в сторону мебели.
   Берутся точки, откуда видно больше всего товаров, и так, чтобы кадры не повторяли друг друга. */
function renderAutoViews(max){
  const poly=innerPoly();if(!poly)return [];
  const c=polyCentroid(poly);T3.scene.updateMatrixWorld();
  const boxes=[];let sx=0,sy=0,sw=0;
  for(const g of T3.room.children){if(!g.userData||g.userData.type!=='furniture')continue;const b=new THREE.Box3().setFromObject(g);if(b.isEmpty())continue;boxes.push(b);
    const s=b.getSize(new THREE.Vector3()),m=b.getCenter(new THREE.Vector3()),wgt=Math.max(0.01,s.x*s.y*s.z);sx+=m.x*1000*wgt;sy+=m.z*1000*wgt;sw+=wgt;}
  /* смотреть — между серединой комнаты и «центром тяжести» мебели */
  const tgt=sw?{x:(c.x+sx/sw)/2,y:(c.y+sy/sw)/2}:c;
  /* стоять можно не вплотную к стене и не внутри высокой мебели (шкаф, стеллаж) */
  const free=(p)=>canStand(p)&&!boxes.some(b=>b.max.y>1.1&&p.x/1000>b.min.x-0.2&&p.x/1000<b.max.x+0.2&&p.y/1000>b.min.z-0.2&&p.y/1000<b.max.z+0.2);
  const cands=[];
  /* откуда снимать: из углов комнаты и от середины длинных стен; from — точка у стены, (dx, dy) — направление внутрь комнаты */
  const spots=poly.map(vtx=>{const dx=c.x-vtx.x,dy=c.y-vtx.y,L=Math.hypot(dx,dy)||1;return {from:vtx,dx:dx/L,dy:dy/L};});
  for(const w of P.walls){const i=D.W.get(w.id);if(!i||i.len<2500)continue;const m={x:(i.a.x+i.b.x)/2,y:(i.a.y+i.b.y)/2};
    const s=pointInPoly({x:m.x+i.nx*600,y:m.y+i.ny*600},poly)?1:-1;spots.push({from:m,dx:i.nx*s,dy:i.ny*s});}
  for(const sp of spots){
    for(let d=450;d<=1600;d+=115){const p={x:sp.from.x+sp.dx*d,y:sp.from.y+sp.dy*d};if(!free(p))continue;
      if(Math.hypot(tgt.x-p.x,tgt.y-p.y)<900)break; // слишком близко к тому, на что смотрим: кадра не получится
      const aim=(t)=>({x:Math.round(p.x),y:Math.round(p.y),eye:P.eyeHeight,yaw:Math.atan2(t.x-p.x,-(t.y-p.y)),pitch:-0.08,fov:62});
      let v=aim(tgt),seen=renderVisible(v);
      /* довернуть камеру к тому, что отсюда действительно видно: в комнате сложной формы общий «центр» может оказаться за углом */
      if(seen.length){let ax=0,ay=0,aw=0;for(const o of seen){const m=o.box.getCenter(new THREE.Vector3());ax+=m.x*1000*o.score;ay+=m.z*1000*o.score;aw+=o.score;}
        const v2=aim({x:(ax/aw*2+tgt.x)/3,y:(ay/aw*2+tgt.y)/3}),seen2=renderVisible(v2);if(seen2.length>=seen.length){v=v2;seen=seen2;}}
      /* высокий предмет ближе метра с небольшим закрывает полкадра и выходит обрезанным — такой ракурс уступает остальным (ковёр под ногами не мешает) */
      const near=boxes.some(b=>b.max.y>0.6&&Math.hypot(Math.max(b.min.x-p.x/1000,0,p.x/1000-b.max.x),Math.max(b.min.z-p.y/1000,0,p.y/1000-b.max.z))<1.1);
      v.score=(seen.reduce((s,o)=>s+o.score,0)+Math.hypot(tgt.x-p.x,tgt.y-p.y)/20000)*(near?0.4:1);cands.push(v);break;}
  }
  cands.sort((a,b)=>b.score-a.score);
  const out=[];const turn=(a,b)=>{const d=Math.abs(a-b)%(2*Math.PI);return Math.min(d,2*Math.PI-d);};
  /* ракурс, с которого видно намного меньше, чем с лучшего, не предлагается (пара ракурсов остаётся всегда) */
  for(const v of cands){if(out.length>=max)break;if(out.length>=2&&v.score<cands[0].score*0.3)break;if(out.some(o=>turn(o.yaw,v.yaw)<0.8&&Math.hypot(o.x-v.x,o.y-v.y)<1500))continue;out.push(v);}
  if(!out.length){ // совсем маленькая комната: из середины в сторону самой длинной стены
    let best=null,bl=-1;for(const w of P.walls){const i=D.W.get(w.id);if(i&&i.len>bl){bl=i.len;best=i;}}
    const t2=best?{x:(best.a.x+best.b.x)/2,y:(best.a.y+best.b.y)/2}:{x:c.x,y:c.y-1};
    out.push({x:Math.round(c.x),y:Math.round(c.y),eye:P.eyeHeight,yaw:Math.atan2(t2.x-c.x,-(t2.y-c.y)),pitch:-0.05,fov:70});
  }
  out.forEach((v,i)=>{v.name=out.length>1?'Ракурс '+(i+1):'Общий вид';delete v.score;});
  return out;
}

/* ---------- что уходит на сервер ---------- */
const renderJpeg=(cv,q)=>{const u=cv.toDataURL('image/jpeg',q);return u.slice(u.indexOf(',')+1);};
/* Отделка поверхности значениями, которые знает сервер: цвет #rrggbb, встроенная текстура или «своё фото» */
function renderMat(m,def){
  if(m&&m.type==='texture'&&TEXLIB.some(t=>t.id===m.textureId))return {type:'texture',textureId:m.textureId};
  if(m&&m.type==='photo')return {type:'photo'};
  const col=String((m&&m.type==='color'&&m.color)||def).toLowerCase();
  return {type:'color',color:/^#[0-9a-f]{6}$/.test(col)?col:def};
}
function renderSceneOf(visible){
  const cnt=new Map();for(const w of P.walls){const k=JSON.stringify(renderMat(w.material,WALL_DEF));cnt.set(k,(cnt.get(k)||0)+1);}
  const walls=[...cnt.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([k])=>JSON.parse(k));
  const items=new Map();for(const o of visible)items.set(o.f.typeId,(items.get(o.f.typeId)||0)+1);
  const kinds=(k)=>Math.min(40,P.openings.filter(o=>o.kind===k).length);
  return {area:Math.max(0.1,Math.round(Math.abs(D.area)/1e5)/10),height:Math.max(1500,Math.min(6000,Math.round(P.wallHeight))),
    walls:walls.length?walls:[renderMat(null,WALL_DEF)],floor:renderMat(P.floor&&P.floor.material,FLOOR_DEF),ceiling:renderMat(P.ceiling&&P.ceiling.material,CEIL_DEF),
    items:[...items.entries()].slice(0,40).map(([typeId,n])=>({typeId,n:Math.min(99,n)})),windows:kinds('window'),doors:kinds('door')};
}
/* Фото товара из каталога, уменьшенное до 512 пикселей: модели этого хватает, а запрос к функции ограничен 4,5 МБ */
async function renderRefData(url){
  const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),6000);
  try{
    const r=await fetch(url,{signal:ctl.signal});if(!r.ok)throw new Error('http '+r.status);
    const bmp=await createImageBitmap(await r.blob());const k=Math.min(1,512/Math.max(bmp.width,bmp.height)),w=Math.max(1,Math.round(bmp.width*k)),hh=Math.max(1,Math.round(bmp.height*k));
    const c=document.createElement('canvas');c.width=w;c.height=hh;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,w,hh);x.drawImage(bmp,0,0,w,hh);
    return renderJpeg(c,0.85);
  }finally{clearTimeout(t);}
}
/* Подпись визуализации — какая расстановка была на плане; тот же вид, что у подписи сметы (order.js) */
function renderLabel(){
  if(!aiHasVariants())return '';
  const a=P.ai.active;return a==='base'?'Исходная расстановка':`Вариант ${a+1}: ${aiCellName(P.ai,a)}`;
}
const renderLabelKey=(s)=>String(s||'').replace(/\s+/g,' ').trim().slice(0,60);
async function renderCreate(src,job,setStep){
  setStep('frame');
  /* модели товаров догружаются сами: до тех пор в кадре вместо мебели серые объёмы */
  for(let t=0;renderLoading()&&t<15000;t+=200)await new Promise(r=>setTimeout(r,200));
  const visible=renderVisible(job.view);
  const frame=renderCapture(job.view,RND.W,RND.H);
  let data=renderJpeg(frame,0.9);if(data.length>1700*1024)data=renderJpeg(frame,0.78);
  /* фото самых заметных товаров в кадре — образцы, по которым модель рисует их внешний вид */
  const want=[];const used=new Set();
  for(const o of visible){if(want.length>=RND.info.refs+2)break;if(used.has(o.f.productId))continue;used.add(o.f.productId);const pr=PRODUCT_BY_ID.get(o.f.productId);const url=pr&&pr.images&&pr.images[0]&&pr.images[0].url;if(url)want.push({productId:pr.id,url});}
  const got=RND.info.refs?await Promise.all(want.map(w=>renderRefData(w.url).then(d=>({productId:w.productId,mime:'image/jpeg',data:d}),()=>null))):[];
  setStep('draw');
  return renderApi(src,'POST','',{frame:{mime:'image/jpeg',data},aspect:RND.ASPECT,mood:job.mood,label:renderLabel(),anchorId:job.anchorId||null,scene:renderSceneOf(visible),refs:got.filter(Boolean).slice(0,RND.info.refs)});
}

/* ---------- окна ---------- */
const renderTitle=(r,i)=>'№ '+(i+1)+(r.mood==='evening'?' · вечер':'');
const renderWhen=(iso)=>{try{return new Date(iso).toLocaleString('ru',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});}catch(e){return '';}};
/* Список готовых визуализаций и создание новой. st — выбор, который сохраняется между окнами: {view, mood, anchorId}.
   → null (закрыть) | {go:'view', id} | {go:'create', view, mood, anchorId} */
function renderSetupDialog(src,st){
  return dialog((box,api)=>{
    const info=RND.info,list=RND.list,can=src.own&&!READONLY&&info.enabled;
    let alive=true;const done=(r)=>{alive=false;api.close(r);};
    box.classList.add('xwide','rnd');
    box.append(h('h3',{},can?'Визуализация комнаты':'Визуализации комнаты'));
    if(can)box.append(h('div',{class:'hint'},'ИИ превращает кадр из 3D‑вида в фотореалистичную картинку: добавляет свет, тени и фактуры. Планировка и мебель остаются вашими, но мелкие детали товаров на картинке могут отличаться от настоящих.'));
    if(list.length){
      box.append(h('div',{class:'rsec'},`Готовые визуализации · ${list.length} из ${info.limit}`));
      const grid=h('div',{class:'rgrid'});
      list.forEach((r,i)=>{const img=h('img',{alt:'Визуализация '+(i+1)});renderImageUrl(src,r.id).then(u=>{if(u&&alive)img.src=u;});
        grid.append(h('button',{type:'button',class:'rcard',title:'Открыть',onclick:()=>done({go:'view',id:r.id})},img,h('span',{},renderTitle(r,i)+(r.label?' · '+r.label:''))));});
      box.append(grid);
    }
    if(!can){
      if(!list.length)box.append(h('div',{class:'hint'},'У этого проекта пока нет визуализаций.'));
      else if(src.own&&!READONLY)box.append(h('div',{class:'pnote',role:'status'},ic('info'),h('div',{},'Создание новых визуализаций пока не подключено.')));
      api.buttons=[{label:'Закрыть',primary:true,cancel:true,onClick:()=>done(null)}];return;
    }
    /* ракурс: то, что сейчас на экране (если вид изнутри), и предложенные — из углов комнаты и от стен */
    const cur=renderCurrentView(),views=(cur?[cur]:[]).concat(renderAutoViews(cur?3:4));
    let pick=Math.max(0,Math.min(views.length-1,st.view||0));
    box.append(h('div',{class:'rsec'},'Ракурс'));
    const vg=h('div',{class:'rgrid'}),cards=[];
    views.forEach((v,i)=>{const cv=h('canvas',{width:'360',height:'240'});const b=h('button',{type:'button',class:'rcard',onclick:()=>{pick=i;mark();}},cv,h('span',{},v.name));cards.push({b,cv,v});vg.append(b);});
    const mark=()=>cards.forEach((k,i)=>{k.b.classList.toggle('on',i===pick);k.b.setAttribute('aria-pressed',String(i===pick));});
    const paint=()=>cards.forEach(k=>{try{k.cv.getContext('2d').drawImage(renderCapture(k.v,360,240),0,0);}catch(e){}});
    mark();paint();box.append(vg);
    if(!cur)box.append(h('div',{class:'hint'},'Нужен свой ракурс? Закройте окно, выберите вид «Изнутри», встаньте и повернитесь как нужно — и нажмите «Визуализация» ещё раз.'));
    const loadNote=h('div',{class:'pnote',role:'status'},ic('info'),h('div',{},'Загружаются 3D‑модели товаров: миниатюры обновятся сами.'));
    let was=renderLoading();loadNote.hidden=!was;box.append(loadNote);
    const tick=setInterval(()=>{if(!alive||!box.isConnected){clearInterval(tick);return;}const ld=renderLoading();if(was&&!ld)paint();was=ld;loadNote.hidden=!ld;},400);
    /* освещение и стиль */
    const moodSeg=h('div',{class:'seg sm',role:'group','aria-label':'Освещение'}),mb={};
    [['day','Днём'],['evening','Вечером']].forEach(([k,nm])=>{mb[k]=h('button',{type:'button',onclick:()=>{st.mood=k;upd();}},nm);moodSeg.append(mb[k]);});
    const sel=h('select',{id:'rndStyle'},h('option',{value:''},'Новый'),...list.map((r,i)=>h('option',{value:r.id},'Как на визуализации '+renderTitle(r,i))));
    if(!list.some(r=>r.id===st.anchorId))st.anchorId=null;sel.value=st.anchorId||'';sel.onchange=()=>{st.anchorId=sel.value||null;upd();};
    const anchorOf=()=>list.find(r=>r.id===st.anchorId)||null;
    /* новый ракурс «в стиле» наследует освещение образца — выбор освещения при этом недоступен */
    const upd=()=>{const a=anchorOf(),m=a?a.mood:st.mood;for(const k in mb){mb[k].classList.toggle('on',k===m);mb[k].setAttribute('aria-pressed',String(k===m));mb[k].disabled=!!a;}};
    upd();
    const opts=h('div',{class:'ropts'},h('div',{},h('span',{},'Освещение'),moodSeg));
    if(list.length)opts.append(h('div',{},h('label',{for:'rndStyle'},'Стиль'),sel));
    box.append(opts);
    if(list.length)box.append(h('div',{class:'hint'},'Чтобы разные ракурсы выглядели одной комнатой, выберите стиль уже готовой визуализации: ИИ повторит её свет и материалы.'));
    const ph=(P.furniture||[]).filter(f=>!f.productId).length;
    if(ph)box.append(h('div',{class:'pnote',role:'status'},ic('info'),h('div',{},`Пустышки без товара (${ph}) на визуализацию не попадут: выберите для них товары в каталоге.`)));
    const full=list.length>=info.limit,spent=info.daily.left===0;
    if(full)box.append(h('div',{class:'pnote warn',role:'status'},ic('alert'),h('div',{},`В проекте уже ${info.limit} визуализаций. Откройте ненужную и удалите её, чтобы создать новую.`)));
    else if(spent)box.append(h('div',{class:'pnote warn',role:'status'},ic('alert'),h('div',{},`Дневной лимит визуализаций исчерпан (${info.daily.limit} в сутки). Попробуйте завтра.`)));
    else if(info.daily.left!=null)box.append(h('div',{class:'hint'},`Сегодня осталось визуализаций: ${info.daily.left} из ${info.daily.limit}.`));
    api.buttons=[{label:'Закрыть',cancel:true,onClick:()=>done(null)},
      {label:'Создать визуализацию',primary:true,onClick:()=>{const a=anchorOf();st.view=pick;done({go:'create',view:views[pick],mood:a?a.mood:st.mood,anchorId:a?a.id:null});}}];
    api.setup=()=>{if(full||spent)api.primaryBtn.disabled=true;};
  });
}
/* Одна визуализация крупно → {go:'setup', anchorId?} | {go:'delete', id} */
function renderViewDialog(src,id){
  const list=RND.list,i=list.findIndex(r=>r.id===id),r=list[i];
  if(!r)return Promise.resolve({go:'setup'});
  return dialog((box,api)=>{
    box.classList.add('xwide','rnd','rview');
    box.append(h('h3',{},'Визуализация '+renderTitle(r,i)),h('div',{class:'summary'},r.label?h('span',{},r.label):null,h('span',{},r.mood==='evening'?'Вечернее освещение':'Дневное освещение'),h('span',{},renderWhen(r.createdAt))));
    const img=h('img',{class:'rbig',alt:'Визуализация комнаты'}),wait=h('div',{class:'hint'},'Загружаем картинку…');box.append(wait,img);
    let url=null;
    renderImageUrl(src,id).then(u=>{url=u;if(u){img.src=u;wait.remove();}else wait.textContent='Не удалось загрузить картинку. Проверьте связь и откройте её ещё раз.';});
    box.append(h('div',{class:'hint'},'Картинку нарисовал ИИ по вашему 3D‑виду: вид и мелкие детали товаров могут отличаться от настоящих. Точные размеры и цены — в смете и на страницах товаров.'));
    const save=()=>{if(!url){toast('Картинка ещё загружается');return;}const name=((P.name||'Комната').replace(/[\\/:*?"<>|]+/g,' ').trim()||'Комната')+' — визуализация '+(i+1)+(r.mime==='image/png'?'.png':r.mime==='image/webp'?'.webp':'.jpg');
      const a=h('a',{href:url,download:name});document.body.append(a);a.click();a.remove();};
    const btns=[{label:'К списку',cancel:true,onClick:a=>a.close({go:'setup'})},{label:'Скачать',onClick:save}];
    if(src.own&&!READONLY){
      btns.splice(1,0,{label:'Удалить',danger:true,onClick:a=>a.close({go:'delete',id})});
      if(RND.info.enabled)btns.push({label:'Ещё ракурс в этом стиле',primary:true,onClick:a=>a.close({go:'setup',anchorId:id})});
    }
    api.buttons=btns;
  });
}
/* Ожидание картинки → {render, daily} | {error} */
function renderBusyDialog(src,job){
  return dialog((box,api)=>{
    box.classList.add('mid','aiprog');
    box.append(h('h3',{},'ИИ рисует комнату'),h('div',{class:'hint'},'Обычно это занимает до минуты. Не закрывайте страницу.'));
    const rows=new Map(),ol=h('ol',{class:'aisteps'});
    [['frame','Готовим кадр и фото товаров'],['draw','Рисуем визуализацию']].forEach(([k,nm])=>{const li=h('li',{},h('i',{}),h('span',{},nm));rows.set(k,li);ol.append(li);});box.append(ol);
    const setStep=(k)=>{let seen=false;for(const [key,li] of rows){li.className=key===k?'now':seen?'':'done';if(key===k)seen=true;}};
    api.buttons=[];
    renderCreate(src,job,setStep).then(r=>api.close(r),e=>api.close({error:e}));
  });
}

/* ---------- вход ---------- */
/* Открыть визуализации проекта: список готовых, создание новой, просмотр. При просмотре чужого проекта — только список. */
async function renderOpen(){
  if(RND.busy||E.dialogOpen)return;
  if(!P.closed){toast('Сначала замкните контур комнаты',true);return;}
  if(typeof needAccount==='function'&&needAccount('Визуализация создаётся и хранится в аккаунте.'))return;
  const src=renderSource();
  if(!src){toast('Проект ещё не сохранён в аккаунт. Проверьте связь и попробуйте снова',true);return;}
  RND.busy=true;
  try{
    try{await renderLoad(src);}catch(e){toast(e.message||'Не удалось загрузить визуализации',true);return;}
    const can=src.own&&!READONLY&&RND.info.enabled;
    if(!can&&!RND.list.length){toast(src.own&&!READONLY?'Визуализация пока не подключена на сервере':'У этого проекта пока нет визуализаций');return;}
    if(can){
      if(typeof THREE==='undefined'||!hasWebGL){toast('Для визуализации нужен 3D‑вид, а он недоступен в этом браузере',true);return;}
      /* кадр снимается с 3D‑сцены: вне 3D открываем вид изнутри из середины комнаты */
      if(!T3.active){const c=polyCentroid(innerPoly()||[{x:0,y:0}]);enter3D(nearestPointTo(c));if(!T3.active)return;}
    }
    const st={view:0,mood:'day',anchorId:null};
    let step={go:'setup'};
    while(step){
      if(step.go==='setup'){if(step.anchorId)st.anchorId=step.anchorId;step=await renderSetupDialog(src,st);}
      else if(step.go==='view')step=await renderViewDialog(src,step.id);
      else if(step.go==='delete'){
        const id=step.id;step={go:'view',id};
        if(await confirmDlg('Удалить визуализацию?','Картинка будет удалена из проекта. Вернуть её будет нельзя.','Удалить',true)){
          try{await renderApi(src,'DELETE','/'+encodeURIComponent(id));RND.list=RND.list.filter(r=>r.id!==id);renderForget(id);if(st.anchorId===id)st.anchorId=null;step={go:'setup'};}
          catch(e){toast(e.message||'Не удалось удалить визуализацию',true);}
        }
      }
      else if(step.go==='create'){
        const out=await renderBusyDialog(src,step);
        if(out&&out.render){RND.list.push(out.render);if(out.daily)RND.info.daily=out.daily;st.view++;step={go:'view',id:out.render.id};} // в следующий раз предлагается следующий ракурс
        else{const e=out&&out.error;toast((e&&e.message)||'Не удалось создать визуализацию',true);
          if(e&&e.status===401)return; // сессия закончилась: дальше — приглашение войти (account.js)
          try{await renderLoad(src);}catch(e2){} // лимит и список могли измениться
          step={go:'setup'};}
      }
      else step=null;
    }
  }finally{RND.busy=false;}
}
/* Визуализация расстановки, выбранной на экране результата: сначала она ставится на план */
function renderOpenFor(which){
  if(which!=null&&aiHasVariants()){const err=aiSwitch(which);if(err){toast(err,true);return;}aiBar();}
  renderOpen();
}
/* Картинки для сметы: до двух последних визуализаций той же расстановки. Смету не задерживают: нет связи — печатается без них. */
async function renderPrintImages(label){
  const src=renderSource();if(!src)return [];
  const lim=(p,ms)=>Promise.race([p,new Promise(r=>setTimeout(()=>r(null),ms))]);
  const j=await lim(renderApi(src,'GET','').catch(()=>null),4000);if(!j||!j.renders)return [];
  const want=renderLabelKey(label),pick=j.renders.filter(r=>r.label===want).slice(-2);
  const urls=await lim(Promise.all(pick.map(r=>renderImageUrl(src,r.id))),8000);
  return (urls||[]).filter(Boolean);
}

(function(){
  const b=$('#btnRender');if(!b)return;
  b.prepend(ic('camera'));b.onclick=renderOpen;b.setAttribute('aria-label','Визуализация комнаты');
  /* проект открыт только на просмотр (по ссылке владельца или поддержкой): кнопка показывает готовые картинки */
  if(/[?&](view|share)=/.test(location.search)){b.querySelector('.lg').textContent='Визуализации';b.title='Готовые визуализации этой комнаты';}
})();
