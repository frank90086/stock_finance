/* ================================================================
   TWSE Analytics — Shared Logic
   Data fetching, indicator calculations, stock list
   ================================================================ */

/* ── Colours (mirror CSS variables for LightweightCharts) ── */
const COLORS = {
  up:'#ef5350', dn:'#26a69a',
  atr7:'#f59e0b', atr14:'#60a5fa',
  grid:'#1c2332', text:'#7d9ab5', border:'#1e2736',
  ma5:'#ff7eb6', ma10:'#f59e0b', ma20:'#ffd23f',
  ma60:'#4ade80', ma120:'#38bdf8', ma240:'#a78bfa',
  bbBand:'#60a5fa', bbMid:'#8899aa',
  kLine:'#a78bfa', dLine:'#f9a8d4',
  macdLine:'#60a5fa', sigLine:'#f59e0b',
};

const MA_DEFS = [
  {p:5,   key:'ma5',   color:COLORS.ma5},
  {p:10,  key:'ma10',  color:COLORS.ma10},
  {p:20,  key:'ma20',  color:COLORS.ma20},
  {p:60,  key:'ma60',  color:COLORS.ma60},
  {p:120, key:'ma120', color:COLORS.ma120},
  {p:240, key:'ma240', color:COLORS.ma240},
];

/* ── Indicator Calculations ── */
function computeATR(bars, period){
  const tr = [];
  for(let i=0;i<bars.length;i++){
    if(i===0){ tr.push(bars[i].high-bars[i].low); continue; }
    const pc = bars[i-1].close;
    tr.push(Math.max(bars[i].high-bars[i].low, Math.abs(bars[i].high-pc), Math.abs(bars[i].low-pc)));
  }
  const out = []; let atr = null;
  for(let i=0;i<bars.length;i++){
    if(i < period-1) continue;
    if(i === period-1){ let s=0; for(let j=0;j<period;j++) s+=tr[j]; atr=s/period; }
    else atr = (atr*(period-1)+tr[i])/period;
    out.push({ time:bars[i].time, value:+atr.toFixed(3) });
  }
  return out;
}

function computeSMA(bars, period){
  const out=[]; let sum=0;
  for(let i=0;i<bars.length;i++){
    sum+=bars[i].close;
    if(i>=period) sum-=bars[i-period].close;
    if(i>=period-1) out.push({ time:bars[i].time, value:+(sum/period).toFixed(2) });
  }
  return out;
}

function computeBoll(bars, period=20, mult=2){
  const up=[], mid=[], low=[];
  for(let i=period-1;i<bars.length;i++){
    let s=0; for(let j=i-period+1;j<=i;j++) s+=bars[j].close;
    const ma=s/period;
    let v=0; for(let j=i-period+1;j<=i;j++){ const d=bars[j].close-ma; v+=d*d; }
    const sd=Math.sqrt(v/period), t=bars[i].time;
    mid.push({time:t,value:+ma.toFixed(2)});
    up.push ({time:t,value:+(ma+mult*sd).toFixed(2)});
    low.push({time:t,value:+(ma-mult*sd).toFixed(2)});
  }
  return {up, mid, low};
}

function computeEMA(values, period){
  const k=2/(period+1); const out=[]; let ema=null, sum=0, cnt=0;
  for(let i=0;i<values.length;i++){
    if(ema===null){ sum+=values[i]; cnt++; if(cnt===period){ ema=sum/period; out.push(ema); } }
    else { ema=values[i]*k+ema*(1-k); out.push(ema); }
  }
  return out;
}

function computeKD(bars, period=9, initVal=50){
  const kArr=[], dArr=[]; let k=initVal, d=initVal;
  for(let i=0;i<bars.length;i++){
    if(i<period-1) continue;
    let lo=bars[i].low, hi=bars[i].high;
    for(let j=i-period+1;j<=i;j++){ lo=Math.min(lo,bars[j].low); hi=Math.max(hi,bars[j].high); }
    const rsv = hi===lo ? 50 : (bars[i].close-lo)/(hi-lo)*100;
    k=k*2/3+rsv/3; d=d*2/3+k/3;
    kArr.push({time:bars[i].time, value:+k.toFixed(2)});
    dArr.push({time:bars[i].time, value:+d.toFixed(2)});
  }
  return {k:kArr, d:dArr};
}

function computeMACD(bars, fast=12, slow=26, sig=9){
  const closes = bars.map(b=>b.close);
  const fastEMA = computeEMA(closes, fast);
  const slowEMA = computeEMA(closes, slow);
  const macdRaw = slowEMA.map((sv,i)=>fastEMA[i+(slow-fast)]-sv);
  const sigArr  = computeEMA(macdRaw, sig);
  const startBar = slow-1+sig-1;
  const macdData=[], signalData=[], histData=[];
  for(let i=0;i<sigArr.length;i++){
    const t=bars[startBar+i].time;
    const m=macdRaw[sig-1+i], s=sigArr[i], h=+(m-s).toFixed(3);
    macdData.push({time:t, value:+m.toFixed(3)});
    signalData.push({time:t, value:+s.toFixed(3)});
    histData.push({time:t, value:h, color:h>=0?'rgba(239,83,80,.65)':'rgba(38,166,154,.65)'});
  }
  return {macd:macdData, signal:signalData, hist:histData};
}

/* ── Data Fetching ── */
const PROXIES = [
  {name:'allorigins', make:u=>'https://api.allorigins.win/raw?url='+encodeURIComponent(u)},
  {name:'thingproxy', make:u=>'https://thingproxy.freeboard.io/fetch/'+u},
  {name:'corseu',     make:u=>'https://cors.eu.org/'+u},
];

function twseURL(stockNo, yyyymmdd){
  return `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${yyyymmdd}&stockNo=${stockNo}`;
}

const FALLBACK_LIST = [
  ['0050','元大台灣50','上市'],['0056','元大高股息','上市'],['00878','國泰永續高股息','上市'],
  ['2330','台積電','上市'],['2317','鴻海','上市'],['2454','聯發科','上市'],
  ['2308','台達電','上市'],['2303','聯電','上市'],['2891','中信金','上市'],
  ['2882','國泰金','上市'],['2881','富邦金','上市'],['2884','玉山金','上市'],
  ['2412','中華電','上市'],['2382','廣達','上市'],['2357','華碩','上市'],
  ['2395','研華','上市'],['3008','大立光','上市'],['2327','國巨','上市'],
  ['2379','瑞昱','上市'],['3231','緯創','上市'],['2376','技嘉','上市'],
  ['2377','微星','上市'],['2356','英業達','上市'],['2409','友達','上市'],
  ['3034','聯詠','上市'],['3037','欣興','上市'],['3045','台灣大','上市'],
  ['4904','遠傳','上市'],['1301','台塑','上市'],['1303','南亞','上市'],
  ['1326','台化','上市'],['2002','中鋼','上市'],['2603','長榮','上市'],
  ['2609','陽明','上市'],['2615','萬海','上市'],['2610','華航','上市'],
  ['2618','長榮航','上市'],['1216','統一','上市'],['2912','統一超','上市'],
  ['2207','和泰車','上市'],['2886','兆豐金','上市'],['2892','第一金','上市'],
  ['2880','華南金','上市'],['2885','元大金','上市'],['2887','台新金','上市'],
  ['2890','永豐金','上市'],['5880','合庫金','上市'],['2345','智邦','上市'],
  ['3661','世芯-KY','上市'],['3443','創意','上市'],['8046','南電','上市'],
  ['3017','奇鋐','上市'],['2059','川湖','上市'],['6446','藥華藥','上市'],
  ['1101','台泥','上市'],['2344','華邦電','上市'],['3711','日月光投控','上市'],
  ['6669','緯穎','上市'],['8299','群聯','上櫃'],['5274','信驊','上櫃'],
  ['6488','環球晶','上櫃'],['3293','鈊象','上櫃'],['6505','台塑化','上市'],
];

let STOCK_LIST = FALLBACK_LIST.map(([code,name,mk])=>({code,name,mk}));
let stockListReady = false;

function twseAllURL(){ return 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'; }
function tpexAllURL(){ return 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes'; }

async function fetchTimeout(url, ms){
  const ctrl=new AbortController();
  const id=setTimeout(()=>ctrl.abort(), ms);
  try{
    return await fetch(url, {cache:'no-store', signal:ctrl.signal});
  } finally { clearTimeout(id); }
}

async function tryJSON(proxy, url, ms=9000){
  const res=await fetchTimeout(proxy.make(url), ms);
  if(!res.ok) throw new Error('HTTP '+res.status);
  return JSON.parse(await res.text());
}

async function loadStockList(){
  const map=new Map();
  STOCK_LIST.forEach(s=>map.set(s.code,s));
  for(const p of PROXIES){
    let got=false;
    try{
      const arr=await tryJSON(p, twseAllURL());
      if(Array.isArray(arr)){
        arr.forEach(r=>{
          const code=r.Code||r['證券代號'], name=r.Name||r['證券名稱'];
          if(/^\d{4,6}$/.test(code) && name) map.set(code,{code,name:name.trim(),mk:'上市'});
        });
        got=true;
      }
    }catch(e){}
    try{
      const arr=await tryJSON(p, tpexAllURL());
      if(Array.isArray(arr)){
        arr.forEach(r=>{
          const code=r.SecuritiesCompanyCode||r.Code||r['股票代號'];
          const name=r.CompanyName||r.Name||r['名稱'];
          if(/^\d{4,6}$/.test(code) && name) map.set(code,{code,name:String(name).trim(),mk:'上櫃'});
        });
      }
    }catch(e){}
    if(got) break;
  }
  STOCK_LIST=[...map.values()];
  stockListReady=true;
}

function searchStocks(q){
  q=q.trim(); if(!q) return [];
  const isNum=/^\d+$/.test(q), ql=q.toLowerCase();
  const scored=[];
  for(const s of STOCK_LIST){
    let score=-1;
    if(isNum){
      if(s.code===q) score=100;
      else if(s.code.startsWith(q)) score=80;
      else if(s.code.includes(q)) score=40;
    } else {
      const nm=s.name.toLowerCase();
      if(nm===ql) score=100;
      else if(nm.startsWith(ql)) score=85;
      else if(nm.includes(ql)) score=70;
      else if(subseq(ql,nm)) score=45;
    }
    if(score>=0) scored.push({s,score});
  }
  scored.sort((a,b)=>b.score-a.score||a.s.code.localeCompare(b.s.code));
  return scored.slice(0,12).map(x=>x.s);
}
function subseq(needle,hay){
  let i=0; for(const ch of hay){ if(ch===needle[i]) i++; if(i===needle.length) return true; } return false;
}

function rocToISO(roc){ const [y,m,d]=roc.split('/'); return `${+y+1911}-${m}-${d}`; }
function num(s){ return parseFloat(String(s).replace(/,/g,'')); }

/* ── localStorage Cache ── */
const CACHE_NS='twse_v2';
function cacheGet(key){
  try{
    const raw=localStorage.getItem(`${CACHE_NS}:${key}`);
    if(!raw) return null;
    const {val,exp}=JSON.parse(raw);
    if(Date.now()>exp){ localStorage.removeItem(`${CACHE_NS}:${key}`); return null; }
    return val;
  }catch{ return null; }
}
function cacheSet(key,val,ttlMs){
  try{
    localStorage.setItem(`${CACHE_NS}:${key}`,JSON.stringify({val,exp:Date.now()+ttlMs}));
  }catch{
    try{
      const keys=Object.keys(localStorage).filter(k=>k.startsWith(CACHE_NS));
      keys.sort().slice(0,Math.ceil(keys.length/2)).forEach(k=>localStorage.removeItem(k));
      localStorage.setItem(`${CACHE_NS}:${key}`,JSON.stringify({val,exp:Date.now()+ttlMs}));
    }catch{}
  }
}
function cacheTTL(ymd){
  const now=new Date();
  const ym=`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;
  if(ymd.startsWith(ym)) return 4*3600_000;
  const eod=new Date(now.getFullYear(),now.getMonth(),now.getDate(),23,59,59,999);
  return Math.max(eod-Date.now(), 3600_000);
}

let sessionProxy=null;

async function fetchViaProxy(proxy, stockNo, ymd, ms=8000){
  const res=await fetchTimeout(proxy.make(twseURL(stockNo, ymd)), ms);
  if(!res.ok) throw new Error('HTTP '+res.status);
  const json=JSON.parse(await res.text());
  if(json.stat==='Value is null'||json.stat==='No data.'||json.stat==='查詢日期大於今日')
    return {data:null, stat:json.stat};
  if(json.stat && json.stat!=='OK') throw new Error(json.stat);
  if(!json.data) throw new Error('無資料');
  return json;
}

async function raceProxies(stockNo, ymd){
  try{
    return await Promise.any(
      PROXIES.map(p=>fetchViaProxy(p,stockNo,ymd,8000).then(json=>({proxy:p,json})))
    );
  }catch{ return null; }
}

async function loadData(stockNo, months, onProgress){
  const now=new Date();
  const reqs=[];
  for(let k=0;k<months;k++){
    const d=new Date(now.getFullYear(),now.getMonth()-k,1);
    reqs.push(`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}01`);
  }
  const rowsMap=new Map(); let name=null, okCount=0;
  const ingest=(j,ymd)=>{
    if(!j||!j.data) return; okCount++;
    if(j.title){ const mm=j.title.match(/\d{2,}\s+(\S+?)\s/); if(mm) name=mm[1]; }
    for(const row of j.data){
      const open=num(row[3]),high=num(row[4]),low=num(row[5]),close=num(row[6]),vol=num(row[1]);
      if([open,high,low,close].some(isNaN)) continue;
      rowsMap.set(rocToISO(row[0]),{time:rocToISO(row[0]),open,high,low,close,volume:isNaN(vol)?0:Math.round(vol/1000)});
    }
  };
  const uncached=[];
  for(const ymd of reqs){
    const hit=cacheGet(`${stockNo}:${ymd}`);
    if(hit) ingest(hit,ymd); else uncached.push(ymd);
  }
  if(!uncached.length){
    if(!rowsMap.size) throw new Error('快取異常，請重新整理');
    return {bars:[...rowsMap.values()].sort((a,b)=>a.time<b.time?-1:1),name,okCount,total:reqs.length,source:'快取'};
  }
  onProgress&&onProgress('正在尋找可用資料通道…');
  const tryCache=(key,j,ymd)=>{ if(j&&j.data) cacheSet(key,j,cacheTTL(ymd)); };
  let wp=sessionProxy;
  if(wp){
    try{
      const j=await fetchViaProxy(wp,stockNo,uncached[0],6000);
      ingest(j,uncached[0]); tryCache(`${stockNo}:${uncached[0]}`,j,uncached[0]);
      uncached.shift();
    }catch{ wp=null; sessionProxy=null; }
  }
  if(!wp){
    let r=null, probeIdx=0;
    for(probeIdx=0;probeIdx<uncached.length;probeIdx++){
      r=await raceProxies(stockNo,uncached[probeIdx]);
      if(r) break;
    }
    if(!r) throw new Error('PROXY_ALL_FAILED');
    wp=r.proxy; sessionProxy=wp;
    ingest(r.json,uncached[probeIdx]); tryCache(`${stockNo}:${uncached[probeIdx]}`,r.json,uncached[probeIdx]);
    uncached.splice(probeIdx,1);
  }
  let done=reqs.length-uncached.length;
  const total=reqs.length;
  onProgress&&onProgress(`通道：${wp.name}　已取得 ${done}/${total} 個月…`);
  await Promise.allSettled(uncached.map(ymd=>
    fetchViaProxy(wp,stockNo,ymd,8000)
      .then(j=>{ ingest(j,ymd); tryCache(`${stockNo}:${ymd}`,j,ymd); })
      .catch(async ()=>{
        for(const p of PROXIES){
          if(p===wp) continue;
          try{ const j=await fetchViaProxy(p,stockNo,ymd,6000); ingest(j,ymd); tryCache(`${stockNo}:${ymd}`,j,ymd); return; }catch{}
        }
      })
      .finally(()=>{ done++; onProgress&&onProgress(`通道：${wp.name}　已取得 ${done}/${total} 個月…`); })
  ));
  if(!rowsMap.size) throw new Error('未取得任何有效資料');
  return {bars:[...rowsMap.values()].sort((a,b)=>a.time<b.time?-1:1),name,okCount,total};
}

async function loadDataYahoo(stockNo, months){
  const end=Math.floor(Date.now()/1000), start=end-months*31*86400;
  for(const sym of [stockNo+'.TW', stockNo+'.TWO']){
    const url=`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?period1=${start}&period2=${end}&interval=1d&includePrePost=false`;
    for(const p of PROXIES){
      try{
        const json=await tryJSON(p,url,10000);
        const result=json?.chart?.result?.[0];
        if(!result?.timestamp?.length) continue;
        const {timestamp,indicators:{quote:[q]}}=result;
        const bars=[];
        for(let i=0;i<timestamp.length;i++){
          if(!q.open?.[i]||!q.close?.[i]) continue;
          const dt=new Date(timestamp[i]*1000);
          bars.push({
            time:`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`,
            open:+q.open[i].toFixed(2), high:+q.high[i].toFixed(2),
            low:+q.low[i].toFixed(2),  close:+q.close[i].toFixed(2),
            volume:Math.round((q.volume[i]||0)/1000)
          });
        }
        if(bars.length<5) continue;
        bars.sort((a,b)=>a.time<b.time?-1:1);
        return {bars,name:result.meta?.shortName||null,okCount:1,total:1,source:'Yahoo Finance'};
      }catch(e){}
    }
  }
  throw new Error('Yahoo Finance 備援失敗');
}

async function loadDataFinMind(stockNo, months){
  const end=new Date(), start=new Date(end.getFullYear(),end.getMonth()-months,1);
  const fmt=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const url=`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${stockNo}&start_date=${fmt(start)}&end_date=${fmt(end)}`;
  const attempts=[
    ()=>fetchTimeout(url,12000).then(r=>r.ok?r.json():Promise.reject('http err')),
    ...PROXIES.map(p=>()=>tryJSON(p,url,12000))
  ];
  for(const attempt of attempts){
    try{
      const json=await attempt();
      if(!json?.data?.length) continue;
      const bars=json.data.filter(r=>r.open&&r.close).map(r=>({
        time:r.date, open:+r.open, high:+r.max, low:+r.min, close:+r.close,
        volume:Math.round((+r.Trading_Volume||0)/1000)
      }));
      if(bars.length<5) continue;
      bars.sort((a,b)=>a.time<b.time?-1:1);
      return {bars,name:null,okCount:1,total:1,source:'FinMind'};
    }catch{}
  }
  throw new Error('所有資料來源均無法連線，請檢查網路後重試');
}

async function fetchWithFallback(stockNo, months, onProgress){
  /* FinMind has CORS * — start it immediately in background.
     If TWSE proxies are healthy they win; if they time out FinMind is already done. */
  const finmindP = loadDataFinMind(stockNo, months).catch(()=>null);

  const twseRace = Promise.race([
    loadData(stockNo, months, onProgress),
    new Promise((_,rej)=>setTimeout(()=>rej(new Error('proxy timeout')), 10000))
  ]);
  try{ return await twseRace; } catch{}

  onProgress&&onProgress('切換至備援資料源…');
  const finmind = await finmindP;  /* already running — resolves instantly if done */
  if(finmind) return finmind;

  onProgress&&onProgress('切換至 Yahoo Finance 備援…');
  try{ return await loadDataYahoo(stockNo, months); } catch{}
  throw new Error('所有資料來源均無法連線，請檢查網路後重試');
}

async function loadFundamentals(stockNo){
  const url='https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d';
  function parse(arr){
    if(!Array.isArray(arr)) return null;
    const r=arr.find(x=>(x.Code||x['證券代號']||'').trim()===stockNo.trim());
    if(!r) return null;
    const pe=r.PEratio??r['本益比']??'';
    const yld=r.DividendYield??r['殖利率(%)']??r['殖利率']??'';
    const pb=r.PBratio??r['股價淨值比']??'';
    return {pe:String(pe).trim()||'—', yld:String(yld).trim()||'—', pb:String(pb).trim()||'—'};
  }
  try{
    const res=await fetchTimeout(url,12000);
    if(res.ok){ const r=parse(await res.json()); if(r) return r; }
  }catch(e){}
  for(const p of PROXIES){
    try{ const r=parse(await tryJSON(p,url,12000)); if(r) return r; }catch(e){}
  }
  return null;
}

/* ── Shared nav injection ── */
function injectNav(activePage){
  // activePage: 'chart' | 'backtest' | ''
  const el=document.getElementById('app-nav');
  if(!el) return;
  el.innerHTML=`
    <a href="index.html" class="nav-logo" aria-label="TWSE Analytics 首頁">
      <span class="blink" aria-hidden="true"></span>
      <span>TWSE Analytics</span>
    </a>
    <div class="nav-links">
      <a href="index.html"    class="nav-link${activePage==='chart'?    ' active':''}"${activePage==='chart'?    ' aria-current="page"':''}>個股走勢</a>
      <a href="backtest.html" class="nav-link${activePage==='backtest'?' active':''}"${activePage==='backtest'?' aria-current="page"':''}>策略回測</a>
    </div>
    <div class="nav-right">
      <span class="nav-exchange">TWSE/TPEX</span>
      <span class="nav-live" aria-label="即時資料" title="資料來自臺灣證券交易所">
        <span class="live-dot" aria-hidden="true"></span>LIVE
      </span>
    </div>`;
}

/* ── Shared search UI wiring ── */
function wireSearchBox(opts){
  // opts: { inputId, suggestId, btnId, onSelect }
  const input=document.getElementById(opts.inputId);
  const box=document.getElementById(opts.suggestId);
  const btn=document.getElementById(opts.btnId);
  if(!input||!box) return;
  let items=[], active=-1;

  function renderSuggest(list){
    items=list; active=-1;
    if(!list.length){
      box.innerHTML=stockListReady
        ?'<div class="empty">找不到符合的股票</div>'
        :'<div class="empty">清單載入中…可直接輸入 4 位數代碼查詢</div>';
      box.hidden=false; return;
    }
    box.innerHTML=list.map((s,i)=>
      `<div class="opt" data-i="${i}" data-code="${s.code}">
         <span class="code">${s.code}</span><span class="nm">${s.name}</span>
         <span class="mk">${s.mk||''}</span>
       </div>`).join('');
    box.hidden=false;
  }
  function closeSuggest(){ box.hidden=true; active=-1; }
  function highlight(){ [...box.querySelectorAll('.opt')].forEach((el,i)=>el.classList.toggle('active',i===active)); }
  function choose(s){
    input.value=`${s.code} ${s.name}`;
    closeSuggest();
    opts.onSelect(s);
  }

  input.addEventListener('input',()=>{
    const q=input.value.trim(); if(!q){ closeSuggest(); return; }
    const qc=q.split(/\s+/)[0];
    renderSuggest(searchStocks(/^\d{1,4}$/.test(qc)&&qc!==q?qc:q));
  });
  input.addEventListener('focus',()=>{ if(input.value.trim()) input.dispatchEvent(new Event('input')); });
  input.addEventListener('keydown',e=>{
    if(box.hidden){ if(e.key==='Enter') submitRaw(); return; }
    if(e.key==='ArrowDown'){ e.preventDefault(); active=Math.min(active+1,items.length-1); highlight(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); active=Math.max(active-1,0); highlight(); }
    else if(e.key==='Enter'){
      e.preventDefault();
      if(active>=0&&items[active]) choose(items[active]);
      else if(items.length===1) choose(items[0]);
      else submitRaw();
    }
    else if(e.key==='Escape') closeSuggest();
  });
  box.addEventListener('click',e=>{
    const opt=e.target.closest('.opt'); if(!opt) return;
    choose(items[+opt.dataset.i]);
  });
  document.addEventListener('click',e=>{
    if(!e.target.closest('.search-wrap')) closeSuggest();
  });

  function submitRaw(){
    const q=input.value.trim(); if(!q) return;
    const fw=q.split(/\s+/)[0];
    if(/^\d{4,6}$/.test(fw)){
      const found=STOCK_LIST.find(s=>s.code===fw);
      opts.onSelect(found||{code:fw,name:fw,mk:''});
    } else {
      const hits=searchStocks(q);
      if(hits.length) choose(hits[0]);
    }
  }
  if(btn) btn.addEventListener('click', submitRaw);
}
