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
  return p;
}
