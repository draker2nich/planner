'use strict';
/* furnitech · редактор · core/units.js
   Константы, единицы измерения, форматирование и разбор длин. Без обращения к странице.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ================= Константы ================= */
const SNAP_R=12, DIM_OFF=24, EDITOR_MARGIN=20000, ZOOM_MAX=5, VERTEX_R=5;
const MIN_WALL=100, MAX_WALL=50000, MIN_H=1000, MAX_H=10000, MIN_T=50, MAX_T=1000;
const DEF={door:{w:800,h:2000},window:{w:1200,h:1400,sill:900},arch:{w:900,h:2100},wallH:2700,wallT:150};
const KIND_NAME={door:'Дверь',window:'Окно',arch:'Арка'};
const UNITS={mm:{f:1,d:0,l:'мм'},cm:{f:10,d:1,l:'см'},m:{f:1000,d:3,l:'м'},in:{f:25.4,d:2,l:'in'},ftin:{f:25.4,d:0,l:'ft-in'}};
const uid=()=>Math.random().toString(36).slice(2,10);

/* ================= Единицы ================= */
function fmt(mm,unit=P.unit){
  if(unit==='ftin'){
    const inch=mm/25.4; let ft=Math.floor(inch/12); let e=Math.round((inch-ft*12)*8); let wi=Math.floor(e/8), fr=e%8;
    if(wi>=12){ft++;wi-=12;}
    let s=`${ft}'`; if(wi||fr){s+=wi; if(fr){let n=fr,d=8; while(n%2===0){n/=2;d/=2;} s+=` ${n}/${d}`;} s+='"';}
    return s;
  }
  const u=UNITS[unit]; let s=(mm/u.f).toFixed(u.d); if(u.d>0) s=s.replace(/\.?0+$/,''); return s;
}
function fmtU(mm){return fmt(mm)+' '+UNITS[P.unit].l;}
function parseLen(str,unit=P.unit){
  str=String(str||'').trim().replace(',','.'); if(!str) return NaN;
  if(unit==='ftin'){
    const m=str.match(/^(\d+)\s*'?\s*(?:(\d+(?:\.\d+)?)?(?:\s+(\d+)\/(\d+))?\s*"?)?$/);
    if(!m) return NaN; let inch=+m[1]*12+(+m[2]||0)+(m[3]?(+m[3]/+m[4]):0); return Math.round(inch*25.4);
  }
  const v=Number(str); if(!isFinite(v)) return NaN; return Math.round(v*UNITS[unit].f);
}
function m2(mm2){return (mm2/1e6).toFixed(2)+' м²';}
