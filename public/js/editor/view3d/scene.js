'use strict';
/* furnitech · редактор · view3d/scene.js
   Сцена three.js, вход и выход из 3D, перемещение, управление указателем, мини‑карта.
   Обычный скрипт (не ES‑модуль): объявления верхнего уровня общие для всех файлов редактора.
   Порядок подключения задан в editor.html. */
/* ---------- Сцена ---------- */
function ensureRenderer(){
  if(T3.ready)return; const c3=$('#c3'); T3.renderer=new THREE.WebGLRenderer({canvas:c3,antialias:true}); T3.renderer.setPixelRatio(Math.min(devicePixelRatio,2)); T3.renderer.outputEncoding=THREE.sRGBEncoding; T3.renderer.toneMapping=THREE.ACESFilmicToneMapping; T3.renderer.toneMappingExposure=1.0;
  T3.scene=new THREE.Scene(); T3.scene.background=new THREE.Color('#bcd4ea'); T3.scene.fog=new THREE.Fog('#bcd4ea',40,200);
  T3.camera=new THREE.PerspectiveCamera(T3.fov,1,0.05,500);
  const hemi=new THREE.HemisphereLight('#dfe9f5','#8a7f6a',0.9); T3.scene.add(hemi); const sun=new THREE.DirectionalLight('#fff4e0',0.8); sun.position.set(30,50,20); T3.scene.add(sun); T3.scene.add(new THREE.AmbientLight('#ffffff',0.3));
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#8a9a7a',roughness:1})); ground.rotation.x=-Math.PI/2; ground.position.y=-0.01; T3.scene.add(ground);
  T3.raycaster=new THREE.Raycaster(); T3.ready=true;
  // модели glb (лениво, с заглушкой)
  ['door','window','arch'].forEach(k=>{T3.models[k]=null; if(THREE.GLTFLoader){try{new THREE.GLTFLoader().load(`assets/models/${k}.glb`,g=>{T3.models[k]=g.scene;T3.dirty=true;},undefined,()=>{});}catch(e){}}});
}
function disposeObj(o){o.traverse(x=>{if(x.geometry)x.geometry.dispose();if(x.material){[].concat(x.material).forEach(m=>{if(m.map&&m.map!==T3.arrowTex)m.map.dispose();m.dispose();});}});}
function rebuildScene(){
  if(!T3.ready)return; if(T3.room){T3.scene.remove(T3.room);disposeObj(T3.room);} T3.room=new THREE.Group(); T3.pickables=[]; T3.scene.add(T3.room);
  const H=P.wallHeight/1000,T=P.wallThickness/1000;
  const extMat=new THREE.MeshStandardMaterial({color:EXT_COL,roughness:0.95});
  for(const w of P.walls){
    const i=D.W.get(w.id); const k=((-i.uy)*i.nx+i.ux*i.ny)>0?1:-1; const start=k>0?i.a:i.b; const dx=i.ux*k,dy=i.uy*k; const L=i.len/1000;
    const shape=new THREE.Shape(); shape.moveTo(0,0);shape.lineTo(L,0);shape.lineTo(L,H);shape.lineTo(0,H);shape.closePath();
    const ops=wallOpenings(w.id); const opsLocal=[];
    for(const o of ops){const c={x:i.ref.x+i.rx*(o.offset+o.width/2),y:i.ref.y+i.ry*(o.offset+o.width/2)};const uc=((c.x-start.x)*dx+(c.y-start.y)*dy)/1000;const hw=o.width/2000,h=o.height/1000,y0=o.kind==='window'?o.sill/1000:0;
      const path=new THREE.Path();
      if(o.kind==='arch'&&o.radius>0){const r=Math.min(o.radius/1000,hw,h);path.moveTo(uc-hw,0);path.lineTo(uc+hw,0);path.lineTo(uc+hw,h-r);path.absarc(uc+hw-r,h-r,r,0,Math.PI/2,false);path.lineTo(uc-hw+r,h);path.absarc(uc-hw+r,h-r,r,Math.PI/2,Math.PI,false);path.closePath();}
      else{path.moveTo(uc-hw,y0);path.lineTo(uc+hw,y0);path.lineTo(uc+hw,y0+h);path.lineTo(uc-hw,y0+h);path.closePath();}
      shape.holes.push(path); opsLocal.push({o,uc,dirFlip:(i.rx*dx+i.ry*dy)<0});}
    const geo=new THREE.ExtrudeGeometry(shape,{depth:T,bevelEnabled:false,curveSegments:12});
    const g0=geo.groups[0],g1=geo.groups[1]; const half=g0.count/2; const pos=geo.attributes.position; const z0=pos.getZ(g0.start); geo.clearGroups();
    geo.addGroup(g0.start,half,Math.abs(z0)<1e-6?0:2); geo.addGroup(g0.start+half,half,Math.abs(z0)<1e-6?2:0); if(g1)geo.addGroup(g1.start,g1.count,1);
    const wm=buildMaterial(w.material,L,H,0,0,false);
    const mesh=new THREE.Mesh(geo,[wm,wm,extMat]); mesh.matrixAutoUpdate=false; mesh.matrix.makeBasis(new THREE.Vector3(dx,0,dy),new THREE.Vector3(0,1,0),new THREE.Vector3(i.nx,0,i.ny)); mesh.matrix.setPosition(start.x/1000,0,start.y/1000); mesh.userData={type:'wall',id:w.id,L,H};
    T3.room.add(mesh); T3.pickables.push(mesh);
    for(const ol of opsLocal){const g=buildOpeningModel(ol.o,T,ol.dirFlip);g.position.set(ol.uc,0,0);mesh.add(g);g.matrixAutoUpdate=true;}
  }
  const poly=innerPoly();
  if(poly){
    const fs=new THREE.Shape(poly.map(p=>new THREE.Vector2(p.x/1000,-p.y/1000))); const xs=poly.map(p=>p.x/1000),ys=poly.map(p=>-p.y/1000); const bw=Math.max(...xs)-Math.min(...xs),bh=Math.max(...ys)-Math.min(...ys);
    const floor=new THREE.Mesh(new THREE.ShapeGeometry(fs),buildMaterial(P.floor?.material,bw,bh,Math.min(...xs),Math.min(...ys),true)); floor.rotation.x=-Math.PI/2; floor.userData={type:'floor'}; T3.room.add(floor); T3.pickables.push(floor);
    const cs=new THREE.Shape(poly.map(p=>new THREE.Vector2(p.x/1000,p.y/1000))); const ceil=new THREE.Mesh(new THREE.ShapeGeometry(cs),new THREE.MeshStandardMaterial({color:'#f4f4f2',roughness:0.95})); ceil.rotation.x=Math.PI/2; ceil.position.y=H; ceil.userData={type:'ceiling'}; T3.room.add(ceil);
  }
  buildFurniture3D(T3.room);
  buildArrows(); if(T3.sel)selectIn3D(T3.sel,true);
}
const MATS={frame:()=>new THREE.MeshStandardMaterial({color:'#f2f2ee',roughness:0.5}),leaf:()=>new THREE.MeshStandardMaterial({color:'#a97c50',roughness:0.6}),metal:()=>new THREE.MeshStandardMaterial({color:'#c8c8cc',roughness:0.3,metalness:0.8}),glass:()=>new THREE.MeshPhysicalMaterial({color:'#d8ecf8',roughness:0.05,metalness:0,transmission:0.85,transparent:true,opacity:0.5})};
function box(w,h,d,mat,x,y,z){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);return m;}
function buildOpeningModel(o,T,flip){
  const g=new THREE.Group(); const w=o.width/1000,h=o.height/1000; const REF={door:[0.8,2.0,0.15],window:[1.2,1.4,0.15],arch:[0.9,2.1,0.15]}[o.kind];
  const glb=T3.models[o.kind];
  if(glb){const m=glb.clone(true);m.scale.set(w/REF[0],h/REF[1],T/REF[2]);m.rotation.y=Math.PI;if(o.kind==='window')m.position.y=o.sill/1000;if(o.kind==='door'&&o.hinge==='right')m.scale.x*=-1;g.add(m);return g;}
  const fr=0.06;
  if(o.kind==='door'){
    g.add(box(fr,h,T,MATS.frame(),-w/2+fr/2,h/2,T/2),box(fr,h,T,MATS.frame(),w/2-fr/2,h/2,T/2),box(w,fr,T,MATS.frame(),0,h-fr/2,T/2));
    const lz=o.swing==='in'?0.05:T-0.05; g.add(box(w-2*fr-0.005,h-fr-0.005,0.04,MATS.leaf(),0,(h-fr)/2,lz));
    let hs=o.hinge==='left'?1:-1; if(flip)hs=-hs; g.add(box(0.12,0.03,0.03,MATS.metal(),hs*(w/2-0.15),1.0,lz-0.035));
  } else if(o.kind==='window'){
    const y0=o.sill/1000; const fm=MATS.frame(); const d=0.09,z=T/2;
    g.add(box(0.07,h,d,fm,-w/2+0.035,y0+h/2,z),box(0.07,h,d,fm,w/2-0.035,y0+h/2,z),box(w,0.07,d,fm,0,y0+h-0.035,z),box(w,0.07,d,fm,0,y0+0.035,z));
    if(w>0.9)g.add(box(0.05,h-0.14,d-0.02,fm,0,y0+h/2,z)); if(h>1.6)g.add(box(w-0.14,0.05,d-0.02,fm,0,y0+h*0.65,z));
    const gl=new THREE.Mesh(new THREE.PlaneGeometry(w-0.14,h-0.14),MATS.glass()); gl.material.side=THREE.DoubleSide; gl.position.set(0,y0+h/2,z); g.add(gl);
    g.add(box(w+0.06,0.03,T+0.05,new THREE.MeshStandardMaterial({color:'#e6e6e2',roughness:0.4}),0,y0-0.015,T/2));
  } else {
    const r=Math.min(o.radius/1000,w/2,h); const fm=MATS.frame(); const z=T/2;
    g.add(box(0.08,h-r,0.1,fm,-w/2+0.04,(h-r)/2,z),box(0.08,h-r,0.1,fm,w/2-0.04,(h-r)/2,z));
    const pts=[]; const hw=w/2; if(r>0.001){for(let a=Math.PI;a>=Math.PI/2-1e-6;a-=Math.PI/24)pts.push(new THREE.Vector3(-(hw-r)+r*Math.cos(a),h-r+r*Math.sin(a),z));if(w-2*r>0.01)pts.push(new THREE.Vector3(hw-r,h,z));for(let a=Math.PI/2;a>=-1e-6;a-=Math.PI/24)pts.push(new THREE.Vector3((hw-r)+r*Math.cos(a),h-r+r*Math.sin(a),z));}
    else{pts.push(new THREE.Vector3(-hw,h,z),new THREE.Vector3(hw,h,z));}
    const curve=new THREE.CatmullRomCurve3(pts,false,'catmullrom',0); g.add(new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(8,pts.length*2),0.045,8,false),fm));
  }
  return g;
}
function arrowTexture(){if(T3.arrowTex)return T3.arrowTex;const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');x.clearRect(0,0,128,128);x.fillStyle='rgba(255,255,255,.85)';x.strokeStyle='rgba(31,95,191,.9)';x.lineWidth=6;x.beginPath();x.moveTo(64,14);x.lineTo(112,70);x.lineTo(84,70);x.lineTo(84,114);x.lineTo(44,114);x.lineTo(44,70);x.lineTo(16,70);x.closePath();x.fill();x.stroke();T3.arrowTex=new THREE.CanvasTexture(c);return T3.arrowTex;}
function buildArrows(){
  if(!T3.room)return; T3.arrows.forEach(a=>T3.room.remove(a)); T3.arrows=[]; if(!P.viewPointsVisible)return;
  const pts=getViewPoints(); const cur=pts[T3.point]; if(!cur)return;
  for(const k in cur.neighbors){const q=pts[cur.neighbors[k]];const dx=(q.x-cur.x)/1000,dz=(q.y-cur.y)/1000;const d=Math.hypot(dx,dz);const t=Math.min(d/2,1.5);
    const m=new THREE.Mesh(new THREE.PlaneGeometry(0.55,0.55),new THREE.MeshBasicMaterial({map:arrowTexture(),transparent:true,depthWrite:false}));
    m.rotation.order='YXZ'; m.rotation.set(-Math.PI/2,Math.atan2(-dx,-dz),0); m.position.set(cur.x/1000+dx/d*t,0.006,cur.y/1000+dz/d*t); m.renderOrder=5; m.userData={type:'arrow',target:q.index}; T3.room.add(m); T3.arrows.push(m);}
}

/* ---------- Вход / выход / цикл ---------- */
function enter3D(idx,opts={}){
  if(typeof THREE==='undefined'){toast('3D‑библиотека не загрузилась, проверьте сеть',true);return;} if(!hasWebGL){toast('3D недоступно в этом браузере',true);return;} if(!P.closed)return;
  ensureRenderer(); const pts=getViewPoints(); T3.point=Math.max(0,Math.min(pts.length-1,idx??P.lastViewPoint??0)); const p=pts[T3.point];
  const c=polyCentroid(innerPoly()); let target=c; if(Math.hypot(c.x-p.x,c.y-p.y)<300){let best=null,bl=-1;for(const w of P.walls){const i=D.W.get(w.id);if(i.len>bl){bl=i.len;best=i;}}target={x:(best.a.x+best.b.x)/2,y:(best.a.y+best.b.y)/2};}
  if(opts.lookAt)target=opts.lookAt;
  T3.yaw=Math.atan2(target.x-p.x,-(target.y-p.y)); if(opts.yaw!=null)T3.yaw=opts.yaw; T3.pitch=0; T3.active=true; T3.sel=null; T3.moving=null;
  $('#view3d').hidden=false; document.body.classList.add('in3d'); $('#tools').hidden=true; $('#catalog').hidden=true; $('#widget').hidden=true; $('#props').hidden=true; $('#dimlist').hidden=true; $('#status').hidden=true;
  $('#btnPoints3d').classList.toggle('on',P.viewPointsVisible); $('#btnPoints3d').setAttribute('aria-pressed',String(P.viewPointsVisible)); setCatalogOpen(false); $('#eyeH').value=P.eyeHeight; $('#eyeHv').textContent=fmtU(P.eyeHeight);
  $('#hint3d').hidden=false; clearTimeout(T3.hintT); T3.hintT=setTimeout(()=>{$('#hint3d').hidden=true;},5000);
  resize3D(); rebuildScene(); if(opts.material)openMaterialPanel(opts.material); else closeMaterialPanel();
  cancelAnimationFrame(T3.raf); loop3D();
}
function exit3D(){if(!T3.active)return;T3.active=false;cancelAnimationFrame(T3.raf);$('#view3d').hidden=true;document.body.classList.remove('in3d');updateModeUI();$('#status').hidden=false;P.lastViewPoint=T3.point;P.lastYaw=T3.yaw;save();closeMaterialPanel();render();}
function resize3D(){if(!T3.ready)return;const r=$('#view3d').getBoundingClientRect();T3.renderer.setSize(r.width,r.height,false);T3.camera.aspect=r.width/r.height;T3.camera.updateProjectionMatrix();}
window.addEventListener('resize',()=>{if(T3.active)resize3D();});
function camPos(){const pts=getViewPoints();const p=pts[T3.point]||{x:0,y:0};return new THREE.Vector3(p.x/1000,P.eyeHeight/1000,p.y/1000);}
function loop3D(){
  if(!T3.active)return; T3.raf=requestAnimationFrame(loop3D);
  if(T3.dirty){T3.dirty=false;const pts=getViewPoints();if(!P.closed){exit3D();toast('Контур разомкнут — 3D закрыт');return;}$('#matPanel').classList.toggle('collapsed',!!P.panelCollapsed);if(T3.point>=pts.length)T3.point=nearestPointTo(T3.lastPos||pts[0]);rebuildScene();}
  let pos; if(T3.moving){const m=T3.moving;let t=(performance.now()-m.t0)/m.dur;if(t>=1){t=1;T3.point=m.to;T3.moving=null;buildArrows();}const e=t<0.5?2*t*t:1-Math.pow(-2*t+2,2)/2;pos=m.from.clone().lerp(m.toPos,e);pos.y=P.eyeHeight/1000;}else pos=camPos();
  T3.lastPos={x:pos.x*1000,y:pos.z*1000};
  const cp=Math.cos(T3.pitch); const dir=new THREE.Vector3(Math.sin(T3.yaw)*cp,Math.sin(T3.pitch),-Math.cos(T3.yaw)*cp);
  T3.camera.position.copy(pos); T3.camera.lookAt(pos.clone().add(dir)); T3.camera.fov=T3.fov; T3.camera.updateProjectionMatrix();
  T3.renderer.render(T3.scene,T3.camera); drawMinimap(); $('#compass').style.transform=`rotate(${-T3.yaw}rad)`;
}
function moveTo(idx){const pts=getViewPoints();if(T3.moving||!pts[idx]||idx===T3.point)return;const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;const from=camPos();const toPos=new THREE.Vector3(pts[idx].x/1000,P.eyeHeight/1000,pts[idx].y/1000);if(reduced){T3.point=idx;buildArrows();return;}T3.moving={from,toPos,to:idx,t0:performance.now(),dur:600};T3.arrows.forEach(a=>T3.room.remove(a));T3.arrows=[];}
function moveByDir(dirName){const pts=getViewPoints();const cur=pts[T3.point];if(!cur)return;const f={x:Math.sin(T3.yaw),y:-Math.cos(T3.yaw)};const v={W:f,S:{x:-f.x,y:-f.y},A:{x:f.y,y:-f.x},D:{x:-f.y,y:f.x}}[dirName];const sec=Math.abs(v.x)>Math.abs(v.y)?(v.x>0?'right':'left'):(v.y>0?'down':'up');if(cur.neighbors[sec]!=null)moveTo(cur.neighbors[sec]);}
function handle3DKey(e){
  const k=e.key.toLowerCase(); const tag=document.activeElement?.tagName; if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA')return false;
  if(e.ctrlKey||e.metaKey){ if(k==='v'&&CLIP){exit3D();copyOpening(CLIP);e.preventDefault();return true;} if(k==='0'){T3.fov=70;e.preventDefault();return true;} return false; }
  if(k==='escape'){if(T3.sel){selectIn3D(null);return true;}exit3D();return true;}
  if(k==='w'||k==='arrowup'){moveByDir('W');return true;} if(k==='s'||k==='arrowdown'){moveByDir('S');return true;} if(k==='a'){moveByDir('A');return true;} if(k==='d'){moveByDir('D');return true;}
  if(k==='q'||k==='arrowleft'){T3.yaw-=Math.PI/12;return true;} if(k==='e'||k==='arrowright'){T3.yaw+=Math.PI/12;return true;}
  if(k==='p'){togglePoints();return true;} if(k==='?'){$('#hint3d').hidden=false;return true;}
  if(/^[1-9]$/.test(k)){moveTo(+k-1);return true;}
  return false;
}
/* ---------- Ввод в 3D ---------- */
(function(){
  const c3=$('#c3'); const ptrs=new Map(); let pinch=null;
  c3.addEventListener('contextmenu',e=>e.preventDefault());
  c3.addEventListener('pointerdown',e=>{c3.setPointerCapture(e.pointerId);ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});if(ptrs.size===2){const [a,b]=[...ptrs.values()];pinch={d0:Math.hypot(a.x-b.x,a.y-b.y)||1,f0:T3.fov};T3.drag=null;return;}T3.drag={x:e.clientX,y:e.clientY,sx:e.clientX,sy:e.clientY,moved:false};});
  c3.addEventListener('pointermove',e=>{if(ptrs.has(e.pointerId))ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pinch&&ptrs.size===2){const [a,b]=[...ptrs.values()];const d=Math.hypot(a.x-b.x,a.y-b.y)||1;T3.fov=Math.max(50,Math.min(90,pinch.f0*pinch.d0/d));return;}if(!T3.drag)return;const dx=e.clientX-T3.drag.x,dy=e.clientY-T3.drag.y;T3.drag.x=e.clientX;T3.drag.y=e.clientY;if(Math.hypot(e.clientX-T3.drag.sx,e.clientY-T3.drag.sy)>4)T3.drag.moved=true;if(T3.drag.moved){T3.yaw+=dx*0.005;T3.pitch=Math.max(-Math.PI/3,Math.min(Math.PI/3,T3.pitch-dy*0.005));}});
  const up=e=>{ptrs.delete(e.pointerId);if(pinch){if(ptrs.size<2)pinch=null;T3.drag=null;return;}if(T3.drag&&!T3.drag.moved){const now=performance.now(),last=T3.lastTap;T3.lastTap={t:now,x:e.clientX,y:e.clientY};if(last&&now-last.t<=350&&Math.hypot(e.clientX-last.x,e.clientY-last.y)<=8){T3.lastTap=null;click3D(e,true);}else click3D(e,false);}else T3.lastTap=null;T3.drag=null;};
  c3.addEventListener('pointerup',up);c3.addEventListener('pointercancel',up);
  c3.addEventListener('wheel',e=>{if(e.ctrlKey){e.preventDefault();T3.fov=Math.max(50,Math.min(90,T3.fov+e.deltaY*0.02));}},{passive:false});
})();
function click3D(e,dbl){
  const r=$('#c3').getBoundingClientRect(); const nd=new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1); T3.raycaster.setFromCamera(nd,T3.camera);
  const ha=T3.raycaster.intersectObjects(T3.arrows,false); if(ha.length){moveTo(ha[0].object.userData.target);return;}
  if(!dbl)return;
  const hs=T3.raycaster.intersectObjects(T3.pickables,false);
  if(hs.length){const h0=hs[0];const ud=h0.object.userData;if(ud.type==='wall'){if(h0.face&&h0.face.materialIndex===2){selectIn3D(null);return;}selectIn3D({type:'wall',id:ud.id});return;}if(ud.type==='floor'){selectIn3D({type:'floor'});return;}if(ud.type==='furniture'){selectIn3D({type:'furniture',id:ud.id});return;}}
  selectIn3D(null);
}
function selectIn3D(sel,silent){
  if(T3.outline){T3.room.remove(T3.outline);T3.outline.geometry.dispose();T3.outline=null;}
  T3.sel=sel; if(!sel){$('#lbl3d').textContent='';if(!silent)closeMaterialPanel();return;}
  const mesh=T3.pickables.find(m=>sel.type==='floor'?m.userData.type==='floor':(m.userData.id===sel.id&&m.userData.type===sel.type)); if(!mesh){T3.sel=null;closeMaterialPanel();return;}
  const eg=new THREE.EdgesGeometry(mesh.geometry,25); const ln=new THREE.LineSegments(eg,new THREE.LineBasicMaterial({color:cssv('--brand')||'#1f5fbf'})); ln.matrixAutoUpdate=false; mesh.updateWorldMatrix(true,false); ln.matrix.copy(mesh.matrixWorld); ln.renderOrder=6; T3.room.add(ln); T3.outline=ln;
  if(sel.type==='furniture'){const f=P.furniture.find(x=>x.id===sel.id);$('#lbl3d').textContent=f.name;openFurnitureCard(f);return;}
  if(sel.type==='wall'){const n=P.walls.findIndex(w=>w.id===sel.id)+1;$('#lbl3d').textContent=`Стена ${n} · ${fmt(D.W.get(sel.id).len)} × ${fmtU(P.wallHeight)}`;}else{$('#lbl3d').textContent='Пол';}
  openMaterialPanel(sel);
}
function drawMinimap(){
  const mm=$('#mm'); if(mm.parentElement.classList.contains('min'))return; const x=mm.getContext('2d'); const W=mm.width,H=mm.height; x.clearRect(0,0,W,H); x.fillStyle=C.paper; x.fillRect(0,0,W,H);
  const rb=roomBox(); const z=Math.min((W-20)/rb.w,(H-20)/rb.h); const tx=(p)=>({x:10+(p.x-rb.x)*z,y:10+(p.y-rb.y)*z});
  const poly=innerPoly(); if(poly){x.fillStyle=floorPlanColor();x.globalAlpha=0.4;x.beginPath();poly.map(tx).forEach((p,k)=>k?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));x.closePath();x.fill();x.globalAlpha=1;}
  x.strokeStyle=C.wall; x.lineWidth=Math.max(2,P.wallThickness*z); for(const w of P.walls){const i=D.W.get(w.id);const a=tx(i.a),b=tx(i.b);x.beginPath();x.moveTo(a.x,a.y);x.lineTo(b.x,b.y);x.stroke();}
  x.strokeStyle=C.accent; x.lineWidth=Math.max(2,P.wallThickness*z); for(const o of P.openings){const i=D.W.get(o.wallId);const a=tx({x:i.ref.x+i.rx*o.offset,y:i.ref.y+i.ry*o.offset}),b=tx({x:i.ref.x+i.rx*(o.offset+o.width),y:i.ref.y+i.ry*(o.offset+o.width)});x.beginPath();x.moveTo(a.x,a.y);x.lineTo(b.x,b.y);x.stroke();}
  const pts=getViewPoints(); const cur=T3.lastPos?tx(T3.lastPos):null;
  if(cur){x.fillStyle='rgba(31,95,191,.25)';x.beginPath();x.moveTo(cur.x,cur.y);x.arc(cur.x,cur.y,40,T3.yaw-Math.PI/2-0.6,T3.yaw-Math.PI/2+0.6);x.closePath();x.fill();}
  if(P.viewPointsVisible)for(const p of pts){const s=tx(p);x.fillStyle=p.index===T3.point?C.accent:C.paper;x.strokeStyle=C.accent;x.lineWidth=1.2;x.beginPath();x.arc(s.x,s.y,4,0,7);x.fill();x.stroke();}
  if(cur){x.fillStyle=C.accent;x.beginPath();x.arc(cur.x,cur.y,3,0,7);x.fill();}
  mm._tx=tx;
}
$('#mm').addEventListener('click',e=>{const mm=$('#mm');const r=mm.getBoundingClientRect();const sx=(e.clientX-r.left)*mm.width/r.width,sy=(e.clientY-r.top)*mm.height/r.height;let b=-1,bd=14;for(const p of getViewPoints()){const s=mm._tx(p);const d=Math.hypot(s.x-sx,s.y-sy);if(d<bd){bd=d;b=p.index;}}if(b>=0)moveTo(b);});
$('#mmToggle').onclick=()=>{const m=$('#minimap');m.classList.toggle('min');$('#mmToggle').innerHTML='';$('#mmToggle').append(ic(m.classList.contains('min')?'chevron-right':'chevron-left'));};
$('#btnExit3d').onclick=exit3D; $('#btnPoints3d').onclick=togglePoints;
$('#eyeH').oninput=e=>{P.eyeHeight=+e.target.value;$('#eyeHv').textContent=fmtU(P.eyeHeight);}; $('#eyeH').onchange=()=>save();
