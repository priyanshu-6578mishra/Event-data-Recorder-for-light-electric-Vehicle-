import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getDatabase, ref, query, limitToLast, onValue } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

// Public Firebase web identifiers. Do not place Wi-Fi passwords, tokens or service account keys here.
// The values below match the uploaded ESP32 sketch. Realtime Database read rules must allow
// this web user's Firebase Authentication account (for example: auth != null).
const firebaseConfig = {
  apiKey: 'AIzaSyBRnCDglWuNp12IRzdSiKBOG_h1lk2vFYs',
  authDomain: 'edr-light-ev.firebaseapp.com',
  databaseURL: 'https://edr-light-ev-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'edr-light-ev'
};
const DEVICE_ID = 'edr01';
const PATH = `edr/${DEVICE_ID}`;
const STALE_AFTER_MS = 20000; // ESP32 sends telemetry every ~5 seconds
const LIMIT_HISTORY = 120;
const LIMIT_EVENTS = 30;
const LABELS = { temp_c:['Temperature (°C)','°C'],gas:['Gas sensor (ADC)','ADC'],volt_v:['Battery voltage (V)','V'],acc_g:['Acceleration (g)','g'] };
const $ = id => document.getElementById(id);
const timeFormat = new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'});
const dateFormat = new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
let demo = false;
let subscriptions = [];
let live = null;
let history = [];
let events = [];
let chart = null;
let chartMetric = 'temp_c';
let toastTimer;
let firebaseError = '';

function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),5500)}
const isNumber = n => typeof n === 'number' && Number.isFinite(n);
const safeNum = (n, precision=1) => isNumber(n) ? n.toFixed(precision) : '—';
const safeDate = ts => isNumber(ts) && ts > 1e11 ? dateFormat.format(new Date(ts)) : 'Time unavailable';
const safeTime = ts => isNumber(ts) && ts > 1e11 ? timeFormat.format(new Date(ts)) : '—';
const escapeHTML = val => String(val).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function stamp(){ $('clock').textContent=timeFormat.format(new Date()); }
function uptimeText(ms){if(!isNumber(ms))return '—';const s=Math.floor(ms/1000),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return d?`${d}d ${h}h ${m}m`:`${h}h ${m}m`;}
function setMetric(id,value,status,percent,danger){$(id).textContent=value;const tag=$(id+'Status');tag.textContent=status;tag.className='status-chip '+(danger?'danger':value==='—'?'':'safe');const bar=$(id==='temperature'?'tempBar':id==='gas'?'gasBar':id==='voltage'?'voltageBar':'accelerationBar');bar.style.width=`${Math.min(100,Math.max(0,percent||0))}%`;bar.style.background=danger?'#ff707d':'#abed5c';}
function showStatus(kind,title,msg,ts){const b=$('statusBanner');b.className='status-banner '+(kind==='critical'?'critical':kind==='offline'?'offline':'');$('statusIcon').textContent=kind==='critical'?'⚠':kind==='offline'?'◌':'◉';$('statusTitle').textContent=title;$('statusMessage').textContent=msg;$('lastUpdate').textContent=safeTime(ts);$('deviceDot').className='device-dot '+(kind==='offline'?'':'ok');$('healthText').textContent=kind==='critical'?'ALERT':kind==='offline'?'OFFLINE':'HEALTHY';$('connState').textContent=kind==='offline'?'Disconnected':demo?'Demo playback':'Connected';$('deviceSub').textContent=kind==='offline'?'No recent live telemetry':demo?'Sample data mode':'Receiving telemetry';}
function updateLive(){
  if(!live){showStatus('offline','Waiting for ESP32 telemetry',firebaseError||'No live reading received yet. Check device connectivity and database permissions.');return;}
  const age = isNumber(live.ts) ? Date.now()-live.ts : Infinity;
  const isStale = !demo && (age>STALE_AFTER_MS || age < -60000);
  const critical = live.state==='CRITICAL';
  if(isStale)showStatus('offline','Device offline / data stale',`Last reading is ${age>=0&&Number.isFinite(age)?Math.round(age/1000)+' seconds old':'missing a valid timestamp'}. Showing last received values.`,live.ts);
  else if(critical)showStatus('critical','Critical safety event detected', 'The ESP32 has flagged an abnormal condition. Check the event log and vehicle immediately.',live.ts);
  else showStatus('normal',demo?'Demo mode — system normal':'Vehicle operating normally','All reported sensors are within the current ESP32 alert state.',live.ts);
  const t=live.temp_c,gas=live.gas,volt=live.volt_v,acc=live.acc_g;
  setMetric('temperature',safeNum(t,1),!isNumber(t)?'Sensor unavailable':t>=45?'High temperature':'Within threshold',isNumber(t)?100*t/60:0,isNumber(t)&&t>=45);
  setMetric('gas',isNumber(gas)?String(Math.round(gas)):'—',!isNumber(gas)?'Sensor unavailable':gas>=3000?'High gas reading':'ADC reading',isNumber(gas)?gas/4095*100:0,isNumber(gas)&&gas>=3000);
  setMetric('voltage',safeNum(volt,2),!isNumber(volt)?'Sensor unavailable':volt<1?'Input not detected':volt<10.5?'Low voltage':volt>14.8?'High voltage':'Within threshold',isNumber(volt)?volt/18*100:0,isNumber(volt)&&volt>=1&&(volt<10.5||volt>14.8));
  setMetric('acceleration',safeNum(acc,2),!isNumber(acc)?'Sensor unavailable':acc>=2.5?'Impact threshold':acc<=0.3?'Freefall threshold':'Reading normal',isNumber(acc)?acc/3.5*100:0,isNumber(acc)&&(acc>=2.5||acc<=.3));
  $('motion').textContent=live.gyro==='MOVING'?'Moving':live.gyro==='STILL'?'Stationary':'Unknown';
  $('uptime').textContent=uptimeText(live.uptime_ms);
  $('dataSource').textContent=demo?'Sample data':'Firebase RTDB';
}
function orderedRecords(obj){return Object.entries(obj||{}).map(([key,value])=>({key,...(value&&typeof value==='object'?value:{})})).sort((a,b)=>(a.ts||0)-(b.ts||0));}
function updateChart(){
  const sorted=history.filter(x=>isNumber(x[chartMetric])).slice(-60);
  const label=LABELS[chartMetric][0];$('chartLegend').textContent=label;$('chartCount').textContent=`${sorted.length} readings`;
  if(!sorted.length){$('historyChart').style.display='none';$('chartFallback').style.display='grid';if(chart){chart.destroy();chart=null;}return;}
  $('chartFallback').style.display='none';$('historyChart').style.display='block';
  if(typeof Chart==='undefined'){$('chartFallback').textContent='Chart library failed to load';$('chartFallback').style.display='grid';return;}
  const color=chartMetric==='temp_c'?'#ffb879':chartMetric==='gas'?'#bdadff':chartMetric==='volt_v'?'#abed5c':'#71b6ff';
  if(chart){chart.destroy();chart=null;}
  chart=new Chart($('historyChart'),{type:'line',data:{labels:sorted.map(x=>safeTime(x.ts)),datasets:[{label,data:sorted.map(x=>x[chartMetric]),borderColor:color,backgroundColor:color+'22',fill:true,tension:.36,pointRadius:sorted.length<20?3:0,pointHoverRadius:4,borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{intersect:false,mode:'index'},plugins:{legend:{display:false},tooltip:{backgroundColor:'#253448',titleColor:'#cbd9e8',bodyColor:'#eaf2fe'}},scales:{x:{ticks:{color:'#8193a7',maxTicksLimit:6,maxRotation:0,font:{size:10}},grid:{display:false},border:{display:false}},y:{ticks:{color:'#8193a7',font:{size:10}},grid:{color:'#ffffff12'},border:{display:false}}}}});
}
function updateEvents(){
  $('eventCount').textContent=events.length;$('sideEventCount').textContent=events.length;
  $('eventFoot').textContent=`Showing ${events.length} latest events (up to ${LIMIT_EVENTS})`;
  if(!events.length){$('eventRows').innerHTML='<tr><td colspan="7" class="empty-table">No recorded critical events found.</td></tr>';return;}
  $('eventRows').innerHTML=[...events].reverse().map(ev=>`<tr><td>#${escapeHTML(ev.event_no??'—')}</td><td>${escapeHTML(safeDate(ev.ts))}</td><td><span class="event-pill">${escapeHTML(ev.state||'CRITICAL')}</span></td><td>${escapeHTML(safeNum(ev.temp_c,1))} °C</td><td>${escapeHTML(safeNum(ev.volt_v,2))} V</td><td>${escapeHTML(isNumber(ev.gas)?ev.gas:'—')}</td><td>${escapeHTML(safeNum(ev.acc_g,2))} g</td></tr>`).join('');
}
function unsubscribeAll(){subscriptions.forEach(fn=>{try{fn()}catch{}});subscriptions=[];}
function subscribeFirebase(){
  unsubscribeAll(); firebaseError='';
  try{
    const app=initializeApp(firebaseConfig);const db=getDatabase(app);const auth=getAuth(app);
    const setup=()=>{
      if(demo)return;unsubscribeAll();
      subscriptions.push(onValue(ref(db,`${PATH}/live`),snap=>{if(demo)return;live=snap.val();firebaseError='';updateLive();},err=>errorState(err)));
      subscriptions.push(onValue(query(ref(db,`${PATH}/history`),limitToLast(LIMIT_HISTORY)),snap=>{if(demo)return;history=orderedRecords(snap.val());updateChart();},err=>errorState(err)));
      subscriptions.push(onValue(query(ref(db,`${PATH}/events`),limitToLast(LIMIT_EVENTS)),snap=>{if(demo)return;events=orderedRecords(snap.val());updateEvents();},err=>errorState(err)));
    };
    onAuthStateChanged(auth,user=>{if(demo)return;if(user){setup()}else signInAnonymously(auth).catch(errorState);});
  }catch(err){errorState(err)}
}
function errorState(err){firebaseError=`Firebase: ${err?.message||String(err)}. Confirm Anonymous Authentication and Realtime Database read rules.`;if(!demo){showStatus('offline','Firebase connection error',firebaseError);toast(firebaseError)}console.error(err)}
function demoData(){
  const now=Date.now();
  history=Array.from({length:60},(_,i)=>{const phase=i/7;return {key:'demo-'+i,ts:now-(59-i)*60000,temp_c:+(29+2*Math.sin(phase)+Math.random()*.5).toFixed(1),gas:1250+Math.round(135*Math.cos(phase)),volt_v:+(12.4+.22*Math.sin(phase/2)).toFixed(2),acc_g:+(.98+.18*Math.sin(phase*2)).toFixed(2),state:'NORMAL'};});
  live={...history[59],gyro:'STILL',uptime_ms:7460000};
  events=[{key:'demo-event-1',ts:now-4800000,event_no:1,state:'CRITICAL',temp_c:46.4,gas:1550,volt_v:12.2,acc_g:1.04},{key:'demo-event-2',ts:now-2200000,event_no:2,state:'CRITICAL',temp_c:32,gas:1600,volt_v:12.1,acc_g:2.84}];
}
function toggleDemo(){
  demo=!demo;$('demoButton').textContent=demo?'Exit demo':'Try demo';$('modeLabel').textContent=demo?'SAMPLE DATA':'LIVE FIREBASE';
  if(demo){unsubscribeAll();demoData();updateLive();updateChart();updateEvents();toast('Demo mode: sample readings only, not actual vehicle data.');}
  else{live=null;history=[];events=[];updateLive();updateChart();updateEvents();subscribeFirebase();toast('Reconnecting to live Firebase data…')}
}
function csvCell(value){const text=value===undefined||value===null?'':String(value);return '"'+text.replace(/"/g,'""')+'"';}
function exportCsv(){
  if(!history.length&&!events.length){toast('No data to export yet.');return;}
  const columns=['type','timestamp','state','temp_c','gas','volt_v','gyro','acc_g','uptime_ms','event_no'];
  const rows=[...history.map(x=>({type:'history',...x})),...events.map(x=>({type:'event',...x}))];
  const csv=[columns.join(','),...rows.map(row=>columns.map(k=>csvCell(row[k])).join(','))].join('\r\n');
  const file=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(file),anchor=document.createElement('a');anchor.href=url;anchor.download=`edr-${DEVICE_ID}-${new Date().toISOString().slice(0,10)}${demo?'-DEMO':''}.csv`;document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);
}
$('metricSelect').addEventListener('change',e=>{chartMetric=e.target.value;updateChart()});
$('demoButton').addEventListener('click',toggleDemo);
$('exportButton').addEventListener('click',exportCsv);
document.querySelectorAll('.nav-link').forEach(a=>a.addEventListener('click',()=>{document.querySelectorAll('.nav-link').forEach(x=>x.classList.remove('active'));a.classList.add('active')}));
stamp();setInterval(stamp,1000);setInterval(()=>{if(!demo)updateLive()},5000);
updateLive();subscribeFirebase();
