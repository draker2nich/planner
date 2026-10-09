'use strict';
/* furnitech · редактор · core/state.js
   Состояние редактора: проект P, производные данные D, история, состояние инструмента E. Без обращения к странице.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ================= Состояние ================= */
let P, D, hist=[], hi=-1;
/* Только просмотр (поддержка открывает чужой проект): ничего не меняется и не сохраняется */
let READONLY=false; const READONLY_MSG='Проект открыт только для просмотра';
function newProject(){
  return {id:uid(),name:'Новый проект',unit:'mm',wallHeight:DEF.wallH,wallThickness:DEF.wallT,lengthsIncludeThickness:false,
    wallParamsSet:false,floor:{material:{type:'color',color:'#d9cfbf'}},viewPointsVisible:true,eyeHeight:1600,photos:[],mode:'walls',furniture:[],fseq:{},status:'draft',showAiBadges:false,panelCollapsed:false,vertices:[],walls:[],openings:[],closed:false,showDims:false,seq:{door:0,window:0,arch:0},
    viewport:{x:0,y:0,zoom:0.08},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
}
const E={propsOpen:false,copyMode:false,tool:'select',mode:'idle',sel:null,hover:null,start:null,stretch:null,ghost:null,openParams:null,drag:null,dialogOpen:false,hintUntil:0,activeDim:null,pointers:new Map(),gesture:null,pan:null,space:false,dimHits:[],markers:[],ctx:null,W:0,H:0,dpr:1,cursorW:null,zoomHintShown:false};


/* Значения по умолчанию для проекта из localStorage или из аккаунта.
   Проект достраивается поверх newProject(): открывается проект с любым набором полей,
   в том числе пустой, созданный сервером. Единица измерения существующего проекта не меняется. */
function normalizeProject(p){
  const d=newProject();
  for(const k in d){ if(p[k]==null) p[k]=d[k]; }
  if(!UNITS[p.unit])p.unit='mm';
  if(!p.seq)p.seq={door:0,window:0,arch:0}; if(!p.floor)p.floor={material:{type:'color',color:'#d9cfbf'}}; if(p.viewPointsVisible==null)p.viewPointsVisible=true; if(!p.eyeHeight)p.eyeHeight=1600; if(!p.photos)p.photos=[]; if(!p.mode)p.mode='walls'; if(!p.furniture)p.furniture=[]; if(!p.fseq)p.fseq={}; if(!p.status)p.status='draft'; if(!p.viewport)p.viewport={x:0,y:0,zoom:0.08}; if(!p.openings)p.openings=[]; if(!p.walls)p.walls=[]; if(!p.vertices)p.vertices=[];
  sanitizeProject(p);
  return p;
}
/* Повреждённые данные (сбой записи, ручная правка localStorage, старая версия) не должны ронять редактор:
   derive() и отрисовка рассчитывают, что стена ссылается на существующие точки, а проём — на существующую стену.
   Всё, что этому не отвечает, отбрасывается. → число отброшенных элементов.
   Молча терять данные нельзя: перед первым изменением проект запоминается как был (SANITIZED.raw), а редактор после
   загрузки сохраняет эту копию в браузере и сообщает пользователю (reportSanitized в core/history.js). */
let SANITIZED=null;
function sanitizeProject(p){
  let dropped=0,raw=null; const obj=(x)=>!!x&&typeof x==='object'&&!Array.isArray(x); const num=(v)=>typeof v==='number'&&isFinite(v);
  const keep=(k,ok)=>{const a=Array.isArray(p[k])?p[k]:[];const b=a.filter(x=>obj(x)&&ok(x));if(b.length!==a.length&&raw==null){try{raw=JSON.stringify(p);}catch(e){raw='';}}dropped+=a.length-b.length;p[k]=b;};
  keep('vertices',v=>v.id!=null&&num(v.x)&&num(v.y));
  const V=new Set(p.vertices.map(v=>v.id));
  const wallsBefore=Array.isArray(p.walls)?p.walls.length:0;
  keep('walls',w=>w.id!=null&&V.has(w.a)&&V.has(w.b)&&w.a!==w.b);
  if(p.walls.length!==wallsBefore)p.closed=false; // контур с выпавшей стеной замкнутым быть не может
  const W=new Set(p.walls.map(w=>w.id));
  keep('openings',o=>o.id!=null&&W.has(o.wallId)&&num(o.offset)&&num(o.width)&&o.width>0);
  keep('furniture',f=>f.id!=null&&typeof f.typeId==='string'&&obj(f.dims)&&num(f.x)&&num(f.y)&&(typeof TYPE==='undefined'||TYPE.has(f.typeId)));
  for(const f of p.furniture){if(!num(f.rot))f.rot=0;if(!obj(f.constraints))f.constraints={};if(!Array.isArray(f.warnings))f.warnings=[];}
  if(!obj(p.viewport)||!num(p.viewport.x)||!num(p.viewport.y)||!num(p.viewport.zoom)||p.viewport.zoom<=0)p.viewport={x:0,y:0,zoom:0.08};
  if(!num(p.wallHeight)||p.wallHeight<=0)p.wallHeight=DEF.wallH; if(!num(p.wallThickness)||p.wallThickness<=0)p.wallThickness=DEF.wallT;
  if(p.mode!=='walls'&&p.mode!=='furniture')p.mode='walls';
  if(dropped)SANITIZED={dropped,raw,name:p.name||''};
  return dropped;
}
