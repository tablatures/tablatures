(function(e){function t(t){for(var r,i,s=t[0],u=t[1],c=t[2],l=0,f=[];l<s.length;l++)i=s[l],Object.prototype.hasOwnProperty.call(a,i)&&a[i]&&f.push(a[i][0]),a[i]=0;for(r in u)Object.prototype.hasOwnProperty.call(u,r)&&(e[r]=u[r]);d&&d(t);while(f.length)f.shift()();return o.push.apply(o,c||[]),n()}function n(){for(var e,t=0;t<o.length;t++){for(var n=o[t],r=!0,i=1;i<n.length;i++){var u=n[i];0!==a[u]&&(r=!1)}r&&(o.splice(t--,1),e=s(s.s=n[0]))}return e}var r={},a={app:0},o=[];function i(e){return s.p+"js/"+({about:"about"}[e]||e)+"."+{about:"35935eed"}[e]+".js"}function s(t){if(r[t])return r[t].exports;var n=r[t]={i:t,l:!1,exports:{}};return e[t].call(n.exports,n,n.exports,s),n.l=!0,n.exports}s.e=function(e){var t=[],n=a[e];if(0!==n)if(n)t.push(n[2]);else{var r=new Promise((function(t,r){n=a[e]=[t,r]}));t.push(n[2]=r);var o,u=document.createElement("script");u.charset="utf-8",u.timeout=120,s.nc&&u.setAttribute("nonce",s.nc),u.src=i(e);var c=new Error;o=function(t){u.onerror=u.onload=null,clearTimeout(l);var n=a[e];if(0!==n){if(n){var r=t&&("load"===t.type?"missing":t.type),o=t&&t.target&&t.target.src;c.message="Loading chunk "+e+" failed.\n("+r+": "+o+")",c.name="ChunkLoadError",c.type=r,c.request=o,n[1](c)}a[e]=void 0}};var l=setTimeout((function(){o({type:"timeout",target:u})}),12e4);u.onerror=u.onload=o,document.head.appendChild(u)}return Promise.all(t)},s.m=e,s.c=r,s.d=function(e,t,n){s.o(e,t)||Object.defineProperty(e,t,{enumerable:!0,get:n})},s.r=function(e){"undefined"!==typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(e,"__esModule",{value:!0})},s.t=function(e,t){if(1&t&&(e=s(e)),8&t)return e;if(4&t&&"object"===typeof e&&e&&e.__esModule)return e;var n=Object.create(null);if(s.r(n),Object.defineProperty(n,"default",{enumerable:!0,value:e}),2&t&&"string"!=typeof e)for(var r in e)s.d(n,r,function(t){return e[t]}.bind(null,r));return n},s.n=function(e){var t=e&&e.__esModule?function(){return e["default"]}:function(){return e};return s.d(t,"a",t),t},s.o=function(e,t){return Object.prototype.hasOwnProperty.call(e,t)},s.p="/TabReader/",s.oe=function(e){throw console.error(e),e};var u=window["webpackJsonp"]=window["webpackJsonp"]||[],c=u.push.bind(u);u.push=t,u=u.slice();for(var l=0;l<u.length;l++)t(u[l]);var d=c;o.push([0,"chunk-vendors"]),n()})({0:function(e,t,n){e.exports=n("cd49")},"5c0b":function(e,t,n){"use strict";n("9c0c")},"73d3":function(e,t,n){"use strict";n("9a34")},"9a34":function(e,t,n){},"9c0c":function(e,t,n){},cd49:function(e,t,n){"use strict";n.r(t);n("e260"),n("e6cf"),n("cca6"),n("a79d");var r=n("2b0e"),a=function(){var e=this,t=e.$createElement,n=e._self._c||t;return n("v-app",[n("v-app-bar",{attrs:{app:"",color:"primary",dark:""}},[n("div",{staticClass:"d-flex align-center"},[n("v-img",{staticClass:"shrink mr-2",attrs:{alt:"Vuetify Logo",contain:"",src:"https://cdn.vuetifyjs.com/images/logos/vuetify-logo-dark.png",transition:"scale-transition",width:"40"}}),n("v-img",{staticClass:"shrink mt-1 hidden-sm-and-down",attrs:{alt:"Vuetify Name",contain:"","min-width":"100",src:"https://cdn.vuetifyjs.com/images/logos/vuetify-name-dark.png",width:"100"}})],1),n("v-spacer"),n("v-btn",{attrs:{href:"https://github.com/vuetifyjs/vuetify/releases/latest",target:"_blank",text:""}},[n("span",{staticClass:"mr-2"},[e._v("Latest Release")]),n("v-icon",[e._v("mdi-open-in-new")])],1)],1),n("v-main",[n("router-view")],1)],1)},o=[],i=r["a"].extend({name:"App",data:function(){return{}}}),s=i,u=(n("5c0b"),n("2877")),c=n("6544"),l=n.n(c),d=n("7496"),f=n("40dc"),p=n("8336"),h=n("132d"),m=n("adda"),v=n("f6c4"),g=n("2fa4"),b=Object(u["a"])(s,a,o,!1,null,null,null),y=b.exports;l()(b,{VApp:d["a"],VAppBar:f["a"],VBtn:p["a"],VIcon:h["a"],VImg:m["a"],VMain:v["a"],VSpacer:g["a"]});n("d3b7"),n("3ca3"),n("ddb0");var w=n("8c4f"),S=function(){var e=this,t=e.$createElement,n=e._self._c||t;return n("v-container",[n("TabReader")],1)},x=[],_=function(){var e=this,t=e.$createElement,n=e._self._c||t;return n("v-container",[n("v-file-input",{attrs:{"prepend-icon":"mdi-music-note",clearable:!1},on:{change:e.onChange},model:{value:e.file,callback:function(t){e.file=t},expression:"file"}}),n("div",[e.loading?n("Loading",{attrs:{status:e.STATUS,completion:e.completion,tasks:e.TASKS_NUMBER}}):e._l(e.svgs,(function(t,r){return n("div",{key:r},[n("div",{domProps:{innerHTML:e._s(t)}})])}))],2)],1)},A=[],O=(n("96cf"),n("5cc6"),n("9a8c"),n("a975"),n("735e"),n("c1ac"),n("d139"),n("3a7b"),n("d5d6"),n("82f8"),n("e91f"),n("60bd"),n("5f96"),n("3280"),n("3fcc"),n("ca91"),n("25a1"),n("cd26"),n("3c5d"),n("2954"),n("649e"),n("219c"),n("170b"),n("b39a"),n("72f7"),n("9ab4")),j=function(){var e=this,t=e.$createElement,n=e._self._c||t;return n("v-container",[n("v-row",{staticClass:"fill-height",attrs:{"align-content":"center",justify:"center"}},[n("v-col",{staticClass:"text-subtitle-1 text-center",attrs:{cols:"12"}},[e._v(e._s(e.Status))]),n("v-col",{attrs:{cols:"6"}},[n("v-progress-linear",{attrs:{value:e.Completion,color:"deep-purple accent-4",rounded:"",height:"6"}})],1)],1)],1)},k=[],V=(n("a9e3"),n("7db0"),n("99af"),{name:"Loading",props:{status:Array,completion:Number,tasks:Number},computed:{Status:function(){var e=this,t=this.status,n=t.find((function(t){return t.id===e.completion}));return"[".concat(this.completion,"/").concat(this.tasks,"] ").concat(n.text)},Completion:function(){return this.completion/this.tasks*100}}}),R=V,T=n("62ad"),C=n("a523"),L=n("8e36"),M=n("0fd9"),P=Object(u["a"])(R,j,k,!1,null,null,null),E=P.exports;l()(P,{VCol:T["a"],VContainer:C["a"],VProgressLinear:L["a"],VRow:M["a"]});var I=n("1f94"),F=500,B=1,N=2,U=3,D=3,G=[{id:B,text:"Loading bytes..."},{id:N,text:"Loading score..."},{id:U,text:"Loadings svgs..."}],$={name:"TabReader",components:{Loading:E},data:function(){return{file:new Blob,bytes:new Uint8Array,sounds:new Uint8Array,score:null,audio:null,svgs:[],loading:!1,completion:B,STATUS:G,LOADING_BYTES:B,LOADING_SCORE:N,LOADING_SVGS:U,TASKS_NUMBER:D}},methods:{onChange:function(e){return Object(O["a"])(this,void 0,void 0,regeneratorRuntime.mark((function t(){return regeneratorRuntime.wrap((function(t){while(1)switch(t.prev=t.next){case 0:return this.loading=!0,t.next=3,this.updateStatus(B);case 3:return t.next=5,this.loadBytes(e);case 5:return this.bytes=t.sent,t.next=8,this.updateStatus(N);case 8:return t.next=10,this.loadScore();case 10:return this.score=t.sent,t.next=13,this.updateStatus(U);case 13:return t.next=15,this.generateSVG();case 15:this.svgs=t.sent,this.loading=!1,console.log(this.score),this.generateMIDI(),console.log(this.audio),this.loadSounds();case 21:case"end":return t.stop()}}),t,this)})))},loadBytes:function(e){return new Promise((function(t,n){var r=new FileReader;r.readAsArrayBuffer(e),r.onloadend=function(e){if(null===e.target)return n();var r=e.target;if(null===r.readyState)return n();r.readyState;if(e.target.readyState==FileReader.DONE){var a=e.target.result;return t(new Uint8Array(a))}}}))},loadScore:function(){var e=this;return new Promise((function(t,n){return t(I["importer"].ScoreLoader.loadScoreFromBytes(e.bytes))}))},generateSVG:function(){var e=this;return new Promise((function(t,n){var r=[],a=new I["rendering"].ScoreRenderer(new I["Settings"]);a.width=1200,a.settings.core.engine="svg",a.partialRenderFinished.on((function(e){r.push(e.renderResult)})),a.renderFinished.on((function(e){return r.pop(),t(r)})),a.renderScore(e.score,[0])}))},generateMIDI:function(){this.audio=new I["midi"].MidiFile;var e=new I["midi"].AlphaSynthMidiFileHandler(this.audio),t=new I["midi"].MidiFileGenerator(this.score,null,e);t.generate()},playMIDI:function(){var e=new I["synth"].AlphaSynth(this.audio);e.loadSoundFont(this.sounds,!1),e.loadMidiFile(this.audio),e.play()},loadSounds:function(){this.sounds=new Uint8Array},updateStatus:function(e){return Object(O["a"])(this,void 0,void 0,regeneratorRuntime.mark((function t(){return regeneratorRuntime.wrap((function(t){while(1)switch(t.prev=t.next){case 0:return this.completion=e,t.next=3,this.delay(F);case 3:case"end":return t.stop()}}),t,this)})))},delay:function(e){return new Promise((function(t){return setTimeout(t,e)}))}}},H=$,J=(n("73d3"),n("23a7")),K=Object(u["a"])(H,_,A,!1,null,null,null),q=K.exports;l()(K,{VContainer:C["a"],VFileInput:J["a"]});var Y=r["a"].extend({name:"Home",components:{TabReader:q}}),z=Y,Q=Object(u["a"])(z,S,x,!1,null,null,null),W=Q.exports;l()(Q,{VContainer:C["a"]}),r["a"].use(w["a"]);var X=[{path:"/",name:"Home",component:W},{path:"/about",name:"About",component:function(){return n.e("about").then(n.bind(null,"f820"))}},{path:"*",name:"catchAll",component:W}],Z=new w["a"]({routes:X}),ee=Z,te=n("2f62");r["a"].use(te["a"]);var ne=new te["a"].Store({state:{},mutations:{},actions:{},modules:{}}),re=n("f309");r["a"].use(re["a"]);var ae=new re["a"]({});r["a"].config.productionTip=!1;var oe=new r["a"]({router:ee,store:ne,vuetify:ae,render:function(e){return e(y)}});oe.$mount("#app")}});
//# sourceMappingURL=app.5869849e.js.map