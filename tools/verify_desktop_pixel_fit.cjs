// Execute the production shell layout with synthetic geometry only.
// No browser, renderer, Engine, WASM, World or game assets are started.
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.resolve(__dirname,'../site/index.html'),'utf8');
const source=html.slice(html.indexOf('function fit(){'),html.indexOf('function fail('));
function target(){return {addEventListener(){}};}
function style(){const values=new Map();return {setProperty(key,value){values.set(key,value);},get(key){return parseFloat(values.get(key));}};}
function fixture(w,h,cw,ch,dpr,fine=true,left=0,top=0){
 const screen={...target(),clientWidth:w,clientHeight:h,style:style(),classList:{add(){},remove(){}},getBoundingClientRect(){return {left,top};}};
 const canvas={width:cw,height:ch};
 const document={...target(),documentElement:{clientWidth:w,style:style()},activeElement:null};
 const window={...target(),devicePixelRatio:dpr,innerHeight:h,scrollX:0,scrollY:0,
  visualViewport:{...target(),width:w,height:h},screen:{},matchMedia(){return {matches:fine};}};
 const context={screen,canvas,document,window,TextEncoder,Event,queueMicrotask,
  requestAnimationFrame(){return 1;},setTimeout(){return 1;},clearTimeout(){},
  ResizeObserver:class{observe(){}},MutationObserver:class{observe(){}}};
 vm.createContext(context);vm.runInContext(source,context,{timeout:1000});
 return {screen,canvas,window,context};
}
function close(actual,expected){assert(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);}
function result(test){const s=test.screen.style;return {w:s.get('--display-width'),h:s.get('--display-height'),x:s.get('--display-left'),y:s.get('--display-top')};}
let desktop=0;
for(const [w,h] of [[1365,699],[1537,863],[1920,1080],[2573,1421]])
 for(const [cw,ch] of [[640,480],[853,641],[1281,673],[1365,699]])
  for(const dpr of [0.8,1,1.1,1.25,1.5,1.75,2,2.5,3])
   for(const [left,top] of [[0,0],[0.4,17.2]]){
    // Only this subset has room for at least one physical pixel per source pixel.
    if(Math.floor((w+left)*dpr)-Math.ceil(left*dpr)<cw||Math.floor((h+top)*dpr)-Math.ceil(top*dpr)<ch)continue;
    const test=fixture(w,h,cw,ch,dpr,true,left,top),r=result(test);
    const scale=r.w*dpr/cw;
    close(scale,Math.round(scale));assert(scale>=1);close(r.h*dpr/ch,scale);
    close((left+r.x)*dpr,Math.round((left+r.x)*dpr));
    close((top+r.y)*dpr,Math.round((top+r.y)*dpr));
    assert(r.x>=-1e-7&&r.y>=-1e-7&&r.x+r.w<=w+1e-7&&r.y+r.h<=h+1e-7);
    assert(Math.abs((2*r.x+r.w-w)*dpr)<=2&&Math.abs((2*r.y+r.h-h)*dpr)<=2);
    // All one-pixel strokes have equal integral output widths, including the
    // last row/column. CSS-to-canvas pointer coordinates use the same bounds.
    for(const pixel of [0,1,7,100,cw-1]){
     const start=(left+r.x)*dpr+pixel*scale;
     close(start,Math.round(start));close(start+scale,Math.round(start+scale));
     close(((r.x+pixel*r.w/cw)-r.x)*cw/r.w,pixel);
    }
    assert.deepEqual(test.canvas,{width:cw,height:ch});
    desktop++;
   }
// A native canvas change, zoom/DPI change, fullscreen and return to an odd
// window size must recompute the fit without touching the backing dimensions.
const live=fixture(1365,699,640,480,1.25);
close(result(live).w*1.25/640,1);
live.canvas.width=1281;live.canvas.height=673;live.window.devicePixelRatio=1.5;
vm.runInContext('fit()',live.context);close(result(live).w*1.5/1281,1);
live.screen.clientWidth=1920;live.screen.clientHeight=1080;live.canvas.width=1920;live.canvas.height=1080;
live.window.devicePixelRatio=1;vm.runInContext('fit()',live.context);
assert.deepEqual(result(live),{w:1920,h:1080,x:0,y:0});
live.screen.clientWidth=1365;live.screen.clientHeight=699;live.canvas.width=1365;live.canvas.height=699;
vm.runInContext('fit()',live.context);assert.deepEqual(result(live),{w:1365,h:699,x:0,y:0});
let shrink=0;
for(const fine of [false,true])for(const [w,h] of [[390,844],[844,390],[320,240]]){
 const test=fixture(w,h,640,480,1,fine),r=result(test);
 const scale=Math.min(w/640,h/480);
 assert.deepEqual(r,{w:Math.floor(640*scale),h:Math.floor(480*scale),x:(w-Math.floor(640*scale))/2,y:(h-Math.floor(480*scale))/2});
 shrink++;
}
// Touch devices retain their existing full-area fit even on high-DPI phones.
assert.deepEqual(result(fixture(390,844,640,480,3,false)),{w:390,h:292,x:0,y:276});
for(const selector of ['#canvas{','#tools{']){
 const css=html.split(selector)[1].split('}')[0];
 assert(css.includes('left:var(--display-left,0px)')&&css.includes('top:var(--display-top,0px)'));
 assert(!css.includes('transform:'));
}
console.log(JSON.stringify({status:'passed',desktop_pixel_grid_cases:desktop,small_window_cases:shrink,
 equal_integer_strokes:true,aligned_origins:true,zoom_and_fullscreen_return:true,touch_fit_preserved:true,
 canvas_backing_unchanged:true,browser_executed:false,gameplay_executed:false}));
