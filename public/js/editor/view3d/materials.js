'use strict';
/* furnitech · редактор · view3d/materials.js
   Процедурные текстуры, фото пользователя (IndexedDB), материалы three.js.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ---------- Библиотека текстур (процедурная) ---------- */
function noise(ctx,size,base,amp,step=2){const id=ctx.getImageData(0,0,size,size),d=id.data;for(let i=0;i<d.length;i+=4){const n=(Math.random()-0.5)*amp;d[i]=Math.max(0,Math.min(255,d[i]+n));d[i+1]=Math.max(0,Math.min(255,d[i+1]+n));d[i+2]=Math.max(0,Math.min(255,d[i+2]+n));}ctx.putImageData(id,0,0);}
function tiles(ctx,size,cols,rows,col,grout,gw){ctx.fillStyle=grout;ctx.fillRect(0,0,size,size);const cw=size/cols,ch=size/rows;for(let i=0;i<cols;i++)for(let j=0;j<rows;j++){ctx.fillStyle=col;ctx.fillRect(i*cw+gw,j*ch+gw,cw-2*gw,ch-2*gw);}}
function planks(ctx,size,n,cols,vertical){ctx.fillStyle=cols[0];ctx.fillRect(0,0,size,size);const pw=size/n;for(let i=0;i<n;i++){const c=cols[1+(i%(cols.length-1))];ctx.fillStyle=c;if(vertical)ctx.fillRect(i*pw+1,0,pw-2,size);else ctx.fillRect(0,i*pw+1,size,pw-2);ctx.strokeStyle='rgba(0,0,0,.12)';for(let k=0;k<14;k++){ctx.beginPath();if(vertical){const x=i*pw+4+Math.random()*(pw-8);ctx.moveTo(x,0);ctx.bezierCurveTo(x+6,size/3,x-6,size*2/3,x+2,size);}else{const y=i*pw+4+Math.random()*(pw-8);ctx.moveTo(0,y);ctx.bezierCurveTo(size/3,y+6,size*2/3,y-6,size,y+2);}ctx.stroke();}}}
const TEXLIB=[
 {id:'plaster',name:'Штукатурка',cat:'paint',physW:1000,physH:1000,forWalls:true,forFloor:false,roughness:0.95,gen:(c,s)=>{c.fillStyle='#eae6dc';c.fillRect(0,0,s,s);noise(c,s,0,22);}},
 {id:'paint-warm',name:'Краска тёплая',cat:'paint',physW:1000,physH:1000,forWalls:true,forFloor:false,roughness:0.85,gen:(c,s)=>{c.fillStyle='#e8d8c0';c.fillRect(0,0,s,s);noise(c,s,0,10);}},
 {id:'paint-cool',name:'Краска холодная',cat:'paint',physW:1000,physH:1000,forWalls:true,forFloor:false,roughness:0.85,gen:(c,s)=>{c.fillStyle='#cfd8dc';c.fillRect(0,0,s,s);noise(c,s,0,10);}},
 {id:'wp-stripes',name:'Обои полоска',cat:'wallpaper',physW:530,physH:530,forWalls:true,forFloor:false,roughness:0.8,gen:(c,s)=>{c.fillStyle='#f1ede4';c.fillRect(0,0,s,s);c.fillStyle='#d8cdb8';for(let i=0;i<8;i++)c.fillRect(i*s/8,0,s/16,s);noise(c,s,0,6);}},
 {id:'wp-dots',name:'Обои горошек',cat:'wallpaper',physW:530,physH:530,forWalls:true,forFloor:false,roughness:0.8,gen:(c,s)=>{c.fillStyle='#e9eef2';c.fillRect(0,0,s,s);c.fillStyle='#b8c7d1';for(let i=0;i<8;i++)for(let j=0;j<8;j++){c.beginPath();c.arc(i*s/8+s/16+(j%2?s/16:0),j*s/8+s/16,s/60,0,7);c.fill();}}},
 {id:'wp-damask',name:'Обои ромб',cat:'wallpaper',physW:530,physH:530,forWalls:true,forFloor:false,roughness:0.8,gen:(c,s)=>{c.fillStyle='#e4dfd3';c.fillRect(0,0,s,s);c.strokeStyle='#c8bfa8';c.lineWidth=3;for(let i=-1;i<6;i++){c.beginPath();c.moveTo(i*s/5,0);c.lineTo(i*s/5+s,s);c.moveTo(i*s/5+s,0);c.lineTo(i*s/5,s);c.stroke();}}},
 {id:'tile-white',name:'Плитка белая 300×600',cat:'tile',physW:600,physH:600,forWalls:true,forFloor:true,roughness:0.35,gen:(c,s)=>tiles(c,s,1,2,'#f4f4f2','#cfcfcb',4)},
 {id:'tile-grey',name:'Плитка серая 600×600',cat:'tile',physW:600,physH:600,forWalls:true,forFloor:true,roughness:0.5,gen:(c,s)=>{tiles(c,s,1,1,'#b9bcbd','#8e9193',5);noise(c,s,0,14);}},
 {id:'tile-mosaic',name:'Мозаика 50 мм',cat:'tile',physW:300,physH:300,forWalls:true,forFloor:true,roughness:0.3,gen:(c,s)=>{c.fillStyle='#d9d9d4';c.fillRect(0,0,s,s);const n=6,w=s/n;for(let i=0;i<n;i++)for(let j=0;j<n;j++){const t=['#6fa8c9','#8fbcd9','#5c93b5','#a9cfe3'][(i*7+j*3)%4];c.fillStyle=t;c.fillRect(i*w+3,j*w+3,w-6,w-6);}}},
 {id:'wood-oak',name:'Дуб',cat:'wood',physW:200,physH:1200,forWalls:true,forFloor:true,roughness:0.7,gen:(c,s)=>planks(c,s,1,['#8a6a45','#c69a68','#b98a58'],false)},
 {id:'wood-dark',name:'Орех',cat:'wood',physW:200,physH:1200,forWalls:true,forFloor:true,roughness:0.65,gen:(c,s)=>planks(c,s,1,['#3f2c1e','#6b4a32','#5a3d29'],false)},
 {id:'laminate',name:'Ламинат серый',cat:'wood',physW:200,physH:1200,forWalls:false,forFloor:true,roughness:0.6,gen:(c,s)=>planks(c,s,1,['#7c7873','#a9a39b','#9b958c'],false)},
 {id:'stone',name:'Камень',cat:'stone',physW:1000,physH:1000,forWalls:true,forFloor:true,roughness:0.9,gen:(c,s)=>{c.fillStyle='#8d8a82';c.fillRect(0,0,s,s);for(let k=0;k<60;k++){c.fillStyle=['#a09d94','#7a776f','#b0ada4'][k%3];c.beginPath();c.ellipse(Math.random()*s,Math.random()*s,20+Math.random()*60,15+Math.random()*40,Math.random()*3,0,7);c.fill();}noise(c,s,0,18);}},
 {id:'concrete',name:'Бетон',cat:'concrete',physW:1000,physH:1000,forWalls:true,forFloor:true,roughness:0.95,gen:(c,s)=>{c.fillStyle='#a5a5a1';c.fillRect(0,0,s,s);noise(c,s,0,30);c.fillStyle='rgba(0,0,0,.08)';for(let k=0;k<40;k++)c.fillRect(Math.random()*s,Math.random()*s,2+Math.random()*30,1+Math.random()*3);}},
 {id:'brick',name:'Кирпич',cat:'stone',physW:500,physH:260,forWalls:true,forFloor:false,roughness:0.9,gen:(c,s)=>{c.fillStyle='#c9c2b6';c.fillRect(0,0,s,s);const rows=4,cols=2,bh=s/rows,bw=s/cols;for(let j=0;j<rows;j++)for(let i=-1;i<=cols;i++){const off=(j%2)*bw/2;c.fillStyle=['#b5563d','#a84e37','#bf6448'][(i+j*3+7)%3];c.fillRect(i*bw+off+4,j*bh+4,bw-8,bh-8);}noise(c,s,0,12);}},
];
function getLibCanvas(id){const t=TEXLIB.find(x=>x.id===id);if(!t)return null;if(!t.canvas){const c=document.createElement('canvas');c.width=c.height=512;t.gen(c.getContext('2d'),512);t.canvas=c;}return t.canvas;}
function getLibTexture(id){if(T3.libTex.has(id))return T3.libTex.get(id);const c=getLibCanvas(id);if(!c)return null;const tex=new THREE.CanvasTexture(c);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.encoding=THREE.sRGBEncoding;tex.anisotropy=8;T3.libTex.set(id,tex);return tex;}

/* ---------- Фото пользователя (IndexedDB) ---------- */
const IDB={db:null,open(){if(this.db)return Promise.resolve(this.db);return new Promise((res,rej)=>{const r=indexedDB.open('roomEditor.assets',1);r.onupgradeneeded=()=>r.result.createObjectStore('photos',{keyPath:'id'});r.onsuccess=()=>{this.db=r.result;res(this.db);};r.onerror=()=>rej(r.error);});},
  tx(mode,fn){return this.open().then(db=>new Promise((res,rej)=>{const t=db.transaction('photos',mode);const st=t.objectStore('photos');const rq=fn(st);rq.onsuccess=()=>res(rq.result);rq.onerror=()=>rej(rq.error);}));},
  put(rec){return this.tx('readwrite',s=>s.put(rec));},get(id){return this.tx('readonly',s=>s.get(id));},del(id){return this.tx('readwrite',s=>s.delete(id));},all(){return this.tx('readonly',s=>s.getAll());}};
async function importPhoto(file){
  if(!/^image\/(jpeg|png|webp)$/.test(file.type))throw new Error('Формат: JPG, PNG или WebP');
  if(file.size>15*1024*1024)throw new Error('Файл больше 15 МБ');
  const bmp=await createImageBitmap(file,{imageOrientation:'from-image'}); const k=Math.min(1,2048/Math.max(bmp.width,bmp.height)); const w=Math.round(bmp.width*k),h=Math.round(bmp.height*k);
  const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(bmp,0,0,w,h);
  const png=file.type==='image/png'; const blob=await new Promise(r=>c.toBlob(r,png?'image/png':'image/jpeg',0.85));
  const all=await IDB.all(); const total=all.reduce((s,r)=>s+r.blob.size,0)+blob.size; if(total>60*1024*1024)throw new Error('Освободите место: удалите неиспользуемые фото');
  const id=uid(); await IDB.put({id,blob,w,h,createdAt:Date.now()}); P.photos=P.photos||[]; P.photos.push(id); save(); return id;
}
function getPhotoTexture(id){
  if(T3.photoTex.has(id))return T3.photoTex.get(id);
  const pr=IDB.get(id).then(rec=>{if(!rec)return null;return createImageBitmap(rec.blob).then(b=>{const t=new THREE.Texture(b);t.encoding=THREE.sRGBEncoding;t.anisotropy=8;t.needsUpdate=true;return t;});}).catch(()=>null);
  T3.photoTex.set(id,pr);return pr;
}
/* Используемые фото: текстуры стен и пола (в том числе в исходной расстановке и вариантах ИИ‑дизайнера) и фото‑референсы брифа */
function usedPhotoIds(){const used=new Set();const mat=(m)=>{if(m&&m.type==='photo'&&m.photoId)used.add(m.photoId);};const brief=(b)=>{((b&&b.photos)||[]).forEach(p=>{if(p&&p.photoId)used.add(p.photoId);});};
  P.walls.forEach(w=>mat(w.material));mat(P.floor?.material);brief(P.brief);brief(P.briefDraft);
  if(P.ai){brief(P.ai.brief);const cell=(c)=>{if(!c||!c.finishes)return;Object.values(c.finishes.walls||{}).forEach(mat);mat(c.finishes.floor);};cell(P.ai.base);(P.ai.variants||[]).forEach(cell);(P.ai.prevVariants||[]).forEach(cell);}
  return used;}
async function gcPhotos(){const used=usedPhotoIds();const all=await IDB.all();let n=0;for(const r of all){if(!used.has(r.id)){await IDB.del(r.id);n++;}}P.photos=[...used];save();toast(n?`Удалено фото: ${n}`:'Неиспользуемых фото нет');}

/* ---------- Материалы three.js ---------- */
function buildMaterial(m,faceW,faceH,u0=0,v0=0,isFloor=false){
  const mat=new THREE.MeshStandardMaterial({color:isFloor?FLOOR_DEF:WALL_DEF,roughness:isFloor?0.6:0.9,side:THREE.FrontSide});
  if(!m||m.type==='color'){mat.color.set(m?.color||(isFloor?FLOOR_DEF:WALL_DEF));mat.roughness=m?.roughness??(isFloor?0.6:0.9);return mat;}
  const rot=(m.rotation||0)*Math.PI/180;
  if(m.type==='texture'){const lib=TEXLIB.find(t=>t.id===m.textureId);const src=getLibTexture(m.textureId);if(!lib||!src)return mat;const tex=src.clone();tex.needsUpdate=true;const sc=(m.scale||100)/100;tex.repeat.set(1/(lib.physW/1000*sc),1/(lib.physH/1000*sc));tex.center.set(0.5,0.5);tex.rotation=rot;const off=m.offset||[0,0];tex.offset.set(off[0]/100,off[1]/100);mat.map=tex;mat.color.set('#ffffff');mat.roughness=lib.roughness;return mat;}
  if(m.type==='photo'){mat.color.set('#c9c9c4');getPhotoTexture(m.photoId).then(src=>{if(!src)return;const iw=src.image.width,ih=src.image.height;let tex;
      if(m.mode==='tile'){tex=src.clone();tex.needsUpdate=true;tex.wrapS=tex.wrapT=THREE.RepeatWrapping;const pw=(m.physW||1000)/1000,ph=pw*ih/iw;const sc=(m.scale||100)/100;tex.repeat.set(1/(pw*sc),1/(ph*sc));tex.center.set(0.5,0.5);tex.rotation=rot;const off=m.offset||[0,0];tex.offset.set(off[0]/100,off[1]/100);}
      else{const fa=faceW/faceH,ia=iw/ih;const cover=(m.fit||'cover')==='cover';const al=(m.align||'cc');const ax={l:0,c:0.5,r:1}[al[1]]??0.5,ay={t:1,c:0.5,b:0}[al[0]]??0.5;
        if(cover){tex=src.clone();tex.needsUpdate=true;tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;let rw,rh;if(ia>fa){rh=1/faceH;rw=1/(faceH*ia);}else{rw=1/faceW;rh=1/(faceW/ia);}tex.repeat.set(rw,rh);tex.offset.set(ax*(1-faceW*rw)-u0*rw,ay*(1-faceH*rh)-v0*rh);}
        else{const cw=1024,ch=Math.round(1024/fa);const c=document.createElement('canvas');c.width=cw;c.height=ch;const x=c.getContext('2d');x.fillStyle=m.bg||'#e9e6df';x.fillRect(0,0,cw,ch);let dw,dh;if(ia>fa){dw=cw;dh=cw/ia;}else{dh=ch;dw=ch*ia;}x.drawImage(src.image,(cw-dw)*ax,(ch-dh)*(1-ay),dw,dh);tex=new THREE.CanvasTexture(c);tex.encoding=THREE.sRGBEncoding;tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;tex.repeat.set(1/faceW,1/faceH);tex.offset.set(-u0/faceW,-v0/faceH);}
        tex.center.set(0.5,0.5);tex.rotation=rot;}
      mat.map=tex;mat.color.set('#ffffff');mat.needsUpdate=true;});return mat;}
  return mat;
}
