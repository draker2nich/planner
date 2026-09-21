/* =====================================================================
   Общий справочник категорий и форм мебели.
   Один источник для редактора (public/index.html), админ‑панели (public/admin.html)
   и сервера (server/*.js). Размеры — в миллиметрах.
   ===================================================================== */
const DIMN={W:'Ширина',D:'Глубина',L:'Длина',A:'Сторона A',B:'Сторона B',R:'Сторона R',DIA:'Диаметр',H:'Высота'};
const DIMLIM={min:100,max:6000};
const CATS=[['living','Гостиная'],['bedroom','Спальня'],['kids','Детская'],['kitchen','Кухня'],['dining','Столовая'],['bath','Ванная'],['toilet','Туалет'],['hall','Прихожая'],['office','Кабинет / офис'],['closet','Гардеробная'],['balcony','Балкон'],['tech','Техника'],['light','Освещение'],['decor','Декор']];
// форма: {id,name,dims:[keys],typical:{},fp:'rect|circle|ellipse|L|U|quarter',mount?}
const F=(id,name,dims,typical,fp,extra={})=>Object.assign({id,name,dims,typical,fp},extra);
const R=(w,d,h,name='Прямоугольный')=>F('rect',name,['W','D'],{W:w,D:d,H:h},'rect');
const TYPES=[
 {id:'sofa',name:'Диван',cats:['living'],symbol:'sofa',mount:'floor',layer:'floor',forms:[F('straight','Прямой',['W','D'],{W:2200,D:900,H:850},'rect'),F('corner','Угловой',['A','B','D'],{A:2600,B:1600,D:900,H:850},'L'),F('u','П‑образный',['A','B','D'],{A:3000,B:1600,D:900,H:850},'U')]},
 {id:'armchair',name:'Кресло',cats:['living','balcony'],symbol:'armchair',mount:'floor',layer:'floor',forms:[R(900,900,850)]},
 {id:'pouf',name:'Пуф',cats:['living'],symbol:'pouf',mount:'floor',layer:'floor',forms:[F('round','Круглый',['DIA'],{DIA:500,H:420},'circle'),R(600,400,420)]},
 {id:'beanbag',name:'Кресло‑мешок',cats:['living','kids'],symbol:'pouf',mount:'floor',layer:'floor',forms:[F('round','Круглое',['DIA'],{DIA:900,H:700},'circle')]},
 {id:'coffee-table',name:'Журнальный стол',cats:['living'],symbol:'table',mount:'floor',layer:'floor',base:true,forms:[R(1100,600,450),F('round','Круглый',['DIA'],{DIA:800,H:450},'circle'),F('oval','Овальный',['W','D'],{W:1100,D:650,H:450},'ellipse')]},
 {id:'tv-stand',name:'ТВ‑тумба',cats:['living'],symbol:'cabinet',mount:'floor',layer:'floor',base:true,forms:[R(1600,450,500)]},
 {id:'tv',name:'Телевизор',cats:['living','bedroom','tech'],symbol:'tv',mount:'wall',layer:'ontop',forms:[F('wall','На стене',['W','D'],{W:1250,D:80,H:720,E:1000},'rect',{mount:'wall'}),F('stand','На тумбе',['W','D'],{W:1250,D:250,H:760},'rect',{mount:'ontop'})]},
 {id:'shelving',name:'Стеллаж',cats:['living','kids','office','closet'],symbol:'shelf',mount:'floor',layer:'floor',forms:[R(800,350,1800)]},
 {id:'bookcase',name:'Книжный шкаф',cats:['living','office'],symbol:'shelf',mount:'floor',layer:'floor',forms:[R(1200,350,2000)]},
 {id:'showcase',name:'Витрина',cats:['living','dining'],symbol:'wardrobe',mount:'floor',layer:'floor',forms:[R(900,400,1900)]},
 {id:'console',name:'Консоль',cats:['living','hall'],symbol:'cabinet',mount:'floor',layer:'floor',base:true,forms:[R(1200,350,800)]},
 {id:'fireplace',name:'Камин',cats:['living'],symbol:'fireplace',mount:'floor',layer:'floor',forms:[R(1200,400,1100,'Пристенный'),F('corner','Угловой',['R'],{R:900,H:1100},'quarter')]},
 {id:'rug',name:'Ковёр',cats:['living','bedroom','kids','decor'],symbol:'rug',mount:'floor',layer:'under',forms:[R(2000,1500,10),F('round','Круглый',['DIA'],{DIA:1600,H:10},'circle'),F('oval','Овальный',['W','D'],{W:2000,D:1400,H:10},'ellipse')]},
 {id:'floor-lamp',name:'Торшер',cats:['living','bedroom','light'],symbol:'lamp',mount:'floor',layer:'floor',forms:[F('round','Круглый',['DIA'],{DIA:350,H:1600},'circle')]},
 {id:'table-lamp',name:'Настольная лампа',cats:['living','bedroom','office','light'],symbol:'lamp',mount:'ontop',layer:'ontop',forms:[F('round','Круглая',['DIA'],{DIA:250,H:450},'circle')]},
 {id:'plant',name:'Растение',cats:['living','balcony','decor'],symbol:'plant',mount:'floor',layer:'floor',forms:[F('round','Кашпо',['DIA'],{DIA:400,H:1200},'circle')]},
 {id:'bed',name:'Кровать',cats:['bedroom'],symbol:'bed',mount:'floor',layer:'floor',forms:[F('single','Односпальная',['W','L'],{W:900,L:2000,H:500},'rect'),F('half','Полуторная',['W','L'],{W:1200,L:2000,H:500},'rect'),F('double','Двуспальная',['W','L'],{W:1600,L:2000,H:500},'rect'),F('king','Кинг',['W','L'],{W:1800,L:2000,H:500},'rect')]},
 {id:'nightstand',name:'Прикроватная тумба',cats:['bedroom'],symbol:'cabinet',mount:'floor',layer:'floor',base:true,forms:[R(450,400,500)]},
 {id:'dresser',name:'Комод',cats:['bedroom','kids'],symbol:'cabinet',mount:'floor',layer:'floor',base:true,forms:[R(1000,450,900)]},
 {id:'wardrobe',name:'Шкаф',cats:['bedroom','kids','hall','office','balcony'],symbol:'wardrobe',mount:'floor',layer:'floor',forms:[R(1800,600,2200,'Прямой'),F('corner','Угловой',['A','B','D'],{A:1600,B:1600,D:600,H:2200},'L')]},
 {id:'closet-system',name:'Гардеробная система',cats:['closet','bedroom'],symbol:'shelf',mount:'floor',layer:'floor',forms:[R(2400,500,2400,'Прямая'),F('corner','Угловая',['A','B','D'],{A:2400,B:1800,D:500,H:2400},'L')]},
 {id:'dressing-table',name:'Туалетный стол',cats:['bedroom'],symbol:'table',mount:'floor',layer:'floor',base:true,forms:[R(1000,450,750)]},
 {id:'bench',name:'Банкетка / скамья',cats:['bedroom','hall','dining','closet'],symbol:'bench',mount:'floor',layer:'floor',forms:[R(1000,400,450)]},
 {id:'mirror',name:'Зеркало',cats:['bedroom','bath','hall','closet','decor'],symbol:'mirror',mount:'wall',layer:'ontop',forms:[F('wall','Настенное',['W','D'],{W:600,D:30,H:800,E:1200},'rect',{mount:'wall'}),F('floor','Напольное',['W','D'],{W:500,D:50,H:1700},'rect',{mount:'floor'})]},
 {id:'kids-bed',name:'Детская кровать',cats:['kids'],symbol:'bed',mount:'floor',layer:'floor',forms:[F('single','Односпальная',['W','L'],{W:800,L:1600,H:450},'rect'),F('bunk','Двухъярусная',['W','L'],{W:900,L:2000,H:1700},'rect'),F('crib','Кроватка',['W','L'],{W:650,L:1250,H:900},'rect')]},
 {id:'changing-table',name:'Пеленальный стол',cats:['kids'],symbol:'cabinet',mount:'floor',layer:'floor',base:true,forms:[R(900,550,950)]},
 {id:'desk',name:'Письменный стол',cats:['kids','office'],symbol:'table',mount:'floor',layer:'floor',base:true,forms:[R(1200,600,750,'Прямой'),F('corner','Угловой',['A','B','D'],{A:1600,B:1400,D:600,H:750},'L')]},
 {id:'chair',name:'Стул',cats:['kids','kitchen','dining','office'],symbol:'chair',mount:'floor',layer:'floor',forms:[R(450,500,900)]},
 {id:'toy-house',name:'Игровой домик',cats:['kids'],symbol:'generic',mount:'floor',layer:'floor',forms:[R(1200,1200,1300)]},
 {id:'kitchen-base',name:'Кухня: нижний сегмент',cats:['kitchen'],symbol:'kitchen',mount:'floor',layer:'floor',base:true,forms:[R(1800,600,900,'Прямой'),F('corner','Угловой',['A','B','D'],{A:2400,B:1800,D:600,H:900},'L')]},
 {id:'kitchen-wall',name:'Кухня: верхний сегмент',cats:['kitchen'],symbol:'kitchen',mount:'wall',layer:'ontop',forms:[F('wall','Навесной',['W','D'],{W:1800,D:350,H:700,E:1450},'rect',{mount:'wall'})]},
 {id:'island',name:'Кухонный остров',cats:['kitchen'],symbol:'kitchen',mount:'floor',layer:'floor',base:true,forms:[R(1200,900,900)]},
 {id:'sink',name:'Мойка',cats:['kitchen'],symbol:'sink',mount:'ontop',layer:'ontop',forms:[R(600,500,200),F('round','Круглая',['DIA'],{DIA:450,H:200},'circle')]},
 {id:'stove',name:'Плита / варочная',cats:['kitchen'],symbol:'stove',mount:'floor',layer:'floor',forms:[R(600,600,850,'Отдельностоящая'),F('hob','Встроенная',['W','D'],{W:600,D:520,H:50},'rect',{mount:'ontop'})]},
 {id:'oven',name:'Духовой шкаф',cats:['kitchen'],symbol:'appliance',mount:'ontop',layer:'ontop',forms:[R(600,550,600)]},
 {id:'hood',name:'Вытяжка',cats:['kitchen'],symbol:'appliance',mount:'wall',layer:'ontop',forms:[F('wall','Настенная',['W','D'],{W:600,D:500,H:600,E:1500},'rect',{mount:'wall'})]},
 {id:'fridge',name:'Холодильник',cats:['kitchen'],symbol:'fridge',mount:'floor',layer:'floor',forms:[R(600,650,1900,'Однодверный'),F('sbs','Side‑by‑side',['W','D'],{W:900,D:700,H:1800},'rect')]},
 {id:'dishwasher',name:'Посудомоечная',cats:['kitchen'],symbol:'appliance',mount:'floor',layer:'floor',forms:[R(600,600,850)]},
 {id:'microwave',name:'Микроволновка',cats:['kitchen'],symbol:'appliance',mount:'ontop',layer:'ontop',forms:[R(500,400,300)]},
 {id:'table',name:'Стол',cats:['kitchen','dining'],symbol:'table',mount:'floor',layer:'floor',base:true,forms:[R(1400,800,750),F('square','Квадратный',['W'],{W:900,H:750},'square'),F('round','Круглый',['DIA'],{DIA:1000,H:750},'circle'),F('oval','Овальный',['W','D'],{W:1600,D:900,H:750},'ellipse')]},
 {id:'bar-counter',name:'Барная стойка',cats:['kitchen'],symbol:'kitchen',mount:'floor',layer:'floor',base:true,forms:[R(1500,500,1100)]},
 {id:'bar-stool',name:'Барный стул',cats:['kitchen'],symbol:'pouf',mount:'floor',layer:'floor',forms:[F('round','Круглый',['DIA'],{DIA:400,H:750},'circle')]},
 {id:'washer',name:'Стиральная машина',cats:['kitchen','bath'],symbol:'appliance',mount:'floor',layer:'floor',base:true,forms:[R(600,600,850)]},
 {id:'dryer',name:'Сушильная машина',cats:['bath'],symbol:'appliance',mount:'ontop',layer:'ontop',forms:[R(600,600,850)]},
 {id:'sideboard',name:'Буфет / сервант',cats:['dining'],symbol:'cabinet',mount:'floor',layer:'floor',base:true,forms:[R(1500,450,900)]},
 {id:'bathtub',name:'Ванна',cats:['bath'],symbol:'bath',mount:'floor',layer:'floor',forms:[R(1700,750,600,'Прямая'),F('corner','Угловая',['R'],{R:1500,H:600},'quarter'),F('oval','Отдельностоящая',['W','D'],{W:1700,D:800,H:600},'ellipse')]},
 {id:'shower',name:'Душевая кабина',cats:['bath'],symbol:'shower',mount:'floor',layer:'floor',forms:[F('square','Квадратная',['W'],{W:900,H:2000},'square'),F('quarter','Угловая‑четверть',['R'],{R:900,H:2000},'quarter'),R(1200,800,2000)]},
 {id:'washbasin',name:'Раковина',cats:['bath','toilet'],symbol:'basin',mount:'floor',layer:'floor',forms:[R(600,450,850,'С тумбой'),F('wall','Подвесная',['W','D'],{W:550,D:450,H:150,E:800},'rect',{mount:'wall'}),F('top','Накладная',['DIA'],{DIA:400,H:150},'circle',{mount:'ontop'})]},
 {id:'vanity',name:'Тумба под раковину',cats:['bath'],symbol:'cabinet',mount:'floor',layer:'floor',base:true,forms:[R(800,450,800)]},
 {id:'toilet',name:'Унитаз',cats:['bath','toilet'],symbol:'toilet',mount:'floor',layer:'floor',forms:[R(380,650,800,'Напольный'),F('wall','Подвесной',['W','D'],{W:360,D:540,H:400,E:400},'rect',{mount:'wall'})]},
 {id:'bidet',name:'Биде',cats:['bath'],symbol:'toilet',mount:'floor',layer:'floor',forms:[R(370,560,400)]},
 {id:'towel-rail',name:'Полотенцесушитель',cats:['bath'],symbol:'radiator',mount:'wall',layer:'ontop',forms:[F('wall','Настенный',['W','D'],{W:500,D:100,H:800,E:900},'rect',{mount:'wall'})]},
 {id:'tall-cabinet',name:'Шкаф‑пенал',cats:['bath'],symbol:'wardrobe',mount:'floor',layer:'floor',forms:[R(350,350,1800)]},
 {id:'boiler',name:'Водонагреватель',cats:['bath','tech'],symbol:'appliance',mount:'wall',layer:'ontop',forms:[F('wall','Настенный',['W','D'],{W:450,D:450,H:800,E:1500},'rect',{mount:'wall'})]},
 {id:'wall-shelf',name:'Полка',cats:['toilet','hall','office','tech'],symbol:'shelf',mount:'wall',layer:'ontop',forms:[F('wall','Настенная',['W','D'],{W:800,D:250,H:30,E:1500},'rect',{mount:'wall'})]},
 {id:'coat-rack',name:'Вешалка',cats:['hall'],symbol:'plant',mount:'floor',layer:'floor',forms:[F('round','Напольная',['DIA'],{DIA:500,H:1800},'circle'),F('wall','Настенная',['W','D'],{W:800,D:150,H:300,E:1600},'rect',{mount:'wall'})]},
 {id:'shoe-rack',name:'Обувница',cats:['hall'],symbol:'cabinet',mount:'floor',layer:'floor',base:true,forms:[R(800,300,900)]},
 {id:'meeting-table',name:'Стол переговорный',cats:['office'],symbol:'table',mount:'floor',layer:'floor',base:true,forms:[R(2400,1000,750),F('oval','Овальный',['W','D'],{W:2400,D:1100,H:750},'ellipse')]},
 {id:'office-chair',name:'Офисное кресло',cats:['office'],symbol:'chair',mount:'floor',layer:'floor',forms:[F('round','Крестовина',['DIA'],{DIA:650,H:1100},'circle')]},
 {id:'pedestal',name:'Тумба подкатная',cats:['office'],symbol:'cabinet',mount:'floor',layer:'floor',base:true,forms:[R(400,500,600)]},
 {id:'safe',name:'Сейф',cats:['office'],symbol:'appliance',mount:'floor',layer:'floor',forms:[R(450,450,600)]},
 {id:'printer',name:'Принтер',cats:['office'],symbol:'appliance',mount:'ontop',layer:'ontop',forms:[R(450,400,250)]},
 {id:'closet-island',name:'Остров гардеробной',cats:['closet'],symbol:'cabinet',mount:'floor',layer:'floor',base:true,forms:[R(1200,800,900)]},
 {id:'small-table',name:'Столик',cats:['balcony'],symbol:'table',mount:'floor',layer:'floor',base:true,forms:[F('round','Круглый',['DIA'],{DIA:600,H:700},'circle'),R(700,500,700)]},
 {id:'drying-rack',name:'Сушилка',cats:['balcony'],symbol:'generic',mount:'floor',layer:'floor',forms:[R(1200,500,1000,'Напольная'),F('wall','Настенная',['W','D'],{W:1200,D:400,H:200,E:1700},'rect',{mount:'wall'})]},
 {id:'ac',name:'Кондиционер',cats:['tech'],symbol:'ac',mount:'wall',layer:'ontop',forms:[F('wall','Настенный',['W','D'],{W:900,D:250,H:300,E:2200},'rect',{mount:'wall'})]},
 {id:'speakers',name:'Колонки',cats:['tech'],symbol:'appliance',mount:'floor',layer:'floor',forms:[R(250,300,1000)]},
 {id:'projector',name:'Проектор',cats:['tech'],symbol:'appliance',mount:'ceiling',layer:'ontop',forms:[R(350,300,150)]},
 {id:'screen',name:'Экран',cats:['tech'],symbol:'picture',mount:'wall',layer:'ontop',forms:[F('wall','Настенный',['W','D'],{W:2000,D:80,H:1200,E:900},'rect',{mount:'wall'})]},
 {id:'radiator',name:'Радиатор',cats:['tech'],symbol:'radiator',mount:'wall',layer:'ontop',forms:[F('wall','Настенный',['W','D'],{W:800,D:100,H:500,E:150},'rect',{mount:'wall'})]},
 {id:'chandelier',name:'Люстра',cats:['light'],symbol:'chandelier',mount:'ceiling',layer:'ontop',forms:[F('round','Круглая',['DIA'],{DIA:600,H:500},'circle')]},
 {id:'ceiling-light',name:'Потолочный светильник',cats:['light'],symbol:'lamp',mount:'ceiling',layer:'ontop',forms:[F('round','Круглый',['DIA'],{DIA:300,H:100},'circle')]},
 {id:'track',name:'Трековая система',cats:['light'],symbol:'generic',mount:'ceiling',layer:'ontop',forms:[R(2000,50,80)]},
 {id:'sconce',name:'Бра',cats:['light'],symbol:'lamp',mount:'wall',layer:'ontop',forms:[F('wall','Настенное',['W','D'],{W:200,D:150,H:250,E:1700},'rect',{mount:'wall'})]},
 {id:'picture',name:'Картина',cats:['decor'],symbol:'picture',mount:'wall',layer:'ontop',forms:[F('wall','Настенная',['W','D'],{W:800,D:40,H:600,E:1300},'rect',{mount:'wall'})]},
 {id:'curtain',name:'Штора',cats:['decor'],symbol:'curtain',mount:'wall',layer:'ontop',forms:[F('wall','У окна',['W','D'],{W:2000,D:150,H:2600,E:0},'rect',{mount:'wall'})]},
 {id:'aquarium',name:'Аквариум',cats:['decor'],symbol:'appliance',mount:'floor',layer:'floor',forms:[R(1000,400,1200)]},
];
const TYPE=new Map(TYPES.map(t=>[t.id,t]));
const BRANDS=['Nord','Lumo','Casa','Verto','Alma','Terra','Orbit','Mira'];
/* Демо‑товары (генерируются из типовых размеров). Используются, пока каталог не загружен с сервера, и для первичного наполнения базы. */
function demoProducts(){const PRODUCTS=[];let n=0;for(const t of TYPES)for(const f of t.forms){[[0.85,'S'],[1,'M'],[1.2,'L']].forEach(([k,sz],i)=>{const dims={};for(const key of f.dims)dims[key]=Math.round(f.typical[key]*k/10)*10;dims.H=Math.round((f.typical.H||500)*(1+(i-1)*0.06)/10)*10;if(f.typical.E!=null)dims.E=f.typical.E;const brand=BRANDS[(n*7)%BRANDS.length];PRODUCTS.push({id:`p-${t.id}-${f.id}-${sz}`,typeId:t.id,formId:f.id,name:`${t.name} ${brand} ${sz}`,brand,price:Math.round((1500+n*37%9000)*k*10),currency:'RUB',dims,tags:[]});n++;});}return PRODUCTS;}
const formOf=(t,fid)=>t.forms.find(f=>f.id===fid)||t.forms[0];

/* Габарит футпринта формы в плане (мм): w — по локальной X, d — по локальной Y (перед предмета смотрит в +Y).
   В 3D (glTF): X = w, Z = d, Y = высота H. Совпадает с fpPoly() редактора. */
function footprintExtents(fp,d){
  const W=d.W??d.A??d.DIA??500, Dd=d.D??d.L??d.DIA??500;
  switch(fp){
    case 'square': return {w:W,d:W};
    case 'circle': {const r=d.DIA||W;return {w:r,d:r};}
    case 'L': case 'U': return {w:d.A,d:d.B};
    case 'quarter': return {w:d.R,d:d.R};
    default: return {w:W,d:Dd};
  }
}
/* Ключи размеров, которые должен заполнить продавец для формы: размеры формы + высота H (+ E — высота установки для настенных) */
function formDimKeys(fo){return [...fo.dims,'H',...(fo.typical.E!=null?['E']:[])];}
if(typeof module!=='undefined'&&module.exports){module.exports={DIMN,DIMLIM,CATS,TYPES,TYPE,BRANDS,formOf,footprintExtents,formDimKeys,demoProducts};}
