'use strict';
/* furnitech · редактор · core/rows.js
   Ряды одинаковых окон и поджатие проёмов при изменении длины стены. Без обращения к странице.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ================= Ряд окон =================
   Несколько одинаковых окон на одной стене. У каждого окна ряда: group (общий id) и groupLayout:
   'even' — равные простенки между окнами и до углов стены (пересчитываются при изменении длины стены);
   'gap'  — ряд с заданными простенками, начало ряда задаётся отступом первого окна.
   Ряд из одного окна ведёт себя как обычное окно. */
const MIN_PIER=100;            // минимальный простенок и отступ от угла при равномерной расстановке, мм
const DEF_PIER=600;            // простенок по умолчанию, мм
const MAX_ROW=12;              // окон в ряду максимум
function nWin(n){const m=n%10,k=n%100;return n+' '+(m===1&&k!==11?'окно':m>=2&&m<=4&&(k<12||k>14)?'окна':'окон');}
function rowOf(o,p=P){if(!o)return [];if(!o.group)return [o];return p.openings.filter(x=>x.group===o.group).sort((a,b)=>a.offset-b.offset);}
function rowGaps(row){return row.slice(1).map((q,k)=>q.offset-row[k].offset-row[k].width);}
function rowUniformGap(row){const g=rowGaps(row);if(!g.length)return null;return g.every(x=>Math.abs(x-g[0])<=1)?g[0]:null;}
function rowSpan(row){if(!row.length)return 0;const last=row[row.length-1];return last.offset+last.width-row[0].offset;}
function evenOffsets(L,n,w){const g=(L-n*w)/(n+1);return {gap:g,offs:Array.from({length:n},(_,k)=>Math.round(g+k*(w+g)))};}
function gapOffsets(start,n,w,gap){return Array.from({length:n},(_,k)=>Math.round(start+k*(w+gap)));}
/* Пересчитать ряд: ch = {width?, start?, gap?, layout?}. Явный start или gap переводит ряд в режим 'gap'. */
function relayoutRow(Q,gid,ch={},d){
  const row=Q.openings.filter(x=>x.group===gid).sort((a,b)=>a.offset-b.offset); if(!row.length)return;
  const i=(d||derive(Q)).W.get(row[0].wallId); if(!i)return;
  const n=row.length, w=ch.width??row[0].width, gaps=rowGaps(row);
  let layout=ch.layout||row[0].groupLayout||'gap'; if((ch.start!=null||ch.gap!=null)&&!ch.layout)layout='gap';
  let offs;
  if(layout==='even') offs=evenOffsets(i.len,n,w).offs;
  else { const start=ch.start??row[0].offset; offs=[Math.round(start)]; for(let k=1;k<n;k++)offs.push(Math.round(offs[k-1]+w+(ch.gap??gaps[k-1]))); }
  row.forEach((q,k)=>{q.width=w;q.offset=offs[k];q.groupLayout=layout;});
}
/* Окно уходит из ряда (удаление, «Отделить», «Переставить»): остальные остаются на месте и больше не «равномерные» */
function leaveRow(Q,id){
  const o=Q.openings.find(x=>x.id===id); if(!o||!o.group)return; const gid=o.group;
  delete o.group; delete o.groupLayout;
  const rest=Q.openings.filter(x=>x.group===gid);
  if(rest.length<=1)rest.forEach(x=>{delete x.group;delete x.groupLayout;}); else rest.forEach(x=>{x.groupLayout='gap';});
}

function clampOpenings(Q,d){
  const done=new Set();
  for(const o of Q.openings){
    const i=d.W.get(o.wallId); if(!i)continue;
    const row=rowOf(o,Q);
    if(row.length>1){ if(done.has(o.group))continue; done.add(o.group);
      if(row[0].groupLayout==='even') relayoutRow(Q,o.group,{},d);
      else { const sp=rowSpan(row); if(row[0].offset+sp>i.len) relayoutRow(Q,o.group,{start:Math.max(0,Math.round(i.len-sp))},d); }
      continue; }
    if(o.offset+o.width>i.len) o.offset=Math.max(0,Math.round(i.len-o.width));
  }
}
