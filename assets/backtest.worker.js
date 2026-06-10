/* ================================================================
   Backtest Web Worker
   Runs strategy simulations off the main thread.
   Input:  { bars, strategy, params }
   Output: { trades, equity, metrics, markers }
   ================================================================ */

/* ── Indicator helpers (duplicated — workers can't import) ── */
function computeEMA(values, period){
  const k=2/(period+1); const out=[]; let ema=null, sum=0, cnt=0;
  for(const v of values){
    if(ema===null){ sum+=v; cnt++; if(cnt===period){ ema=sum/period; out.push(ema); } }
    else{ ema=v*k+ema*(1-k); out.push(ema); }
  }
  return out;
}
function computeSMA_arr(values, period){
  const out=[]; let sum=0;
  for(let i=0;i<values.length;i++){
    sum+=values[i];
    if(i>=period) sum-=values[i-period];
    if(i>=period-1) out.push(sum/period);
  }
  return out;
}
function computeATR_arr(bars, period){
  const tr=[];
  for(let i=0;i<bars.length;i++){
    if(i===0){ tr.push(bars[i].high-bars[i].low); continue; }
    const pc=bars[i-1].close;
    tr.push(Math.max(bars[i].high-bars[i].low,Math.abs(bars[i].high-pc),Math.abs(bars[i].low-pc)));
  }
  const atr=[]; let a=null;
  for(let i=0;i<bars.length;i++){
    if(i<period-1){ atr.push(null); continue; }
    if(i===period-1){ let s=0; for(let j=0;j<period;j++) s+=tr[j]; a=s/period; }
    else a=(a*(period-1)+tr[i])/period;
    atr.push(a);
  }
  return atr;
}
function computeKD_arr(bars, period=9, initVal=50){
  const kArr=[], dArr=[]; let k=initVal, d=initVal;
  for(let i=0;i<bars.length;i++){
    if(i<period-1){ kArr.push(null); dArr.push(null); continue; }
    let lo=bars[i].low, hi=bars[i].high;
    for(let j=i-period+1;j<=i;j++){ lo=Math.min(lo,bars[j].low); hi=Math.max(hi,bars[j].high); }
    const rsv=hi===lo?50:(bars[i].close-lo)/(hi-lo)*100;
    k=k*2/3+rsv/3; d=d*2/3+k/3;
    kArr.push(k); dArr.push(d);
  }
  return {k:kArr, d:dArr};
}

/* ── Signal Generators ── */
// Returns array of {type:'buy'|'sell', idx} — signals at end of bar[idx]
// Entry/exit execute at bar[idx+1].open (no look-ahead)

function maCrossSignals(bars, fastP, slowP){
  const closes=bars.map(b=>b.close);
  const fast=computeSMA_arr(closes, fastP);
  const slow=computeSMA_arr(closes, slowP);
  const signals=[];
  // offset: fast starts at fastP-1, slow at slowP-1
  const startI=slowP-1;
  for(let i=startI;i<bars.length-1;i++){
    const fi=i-(fastP-1), si=i-(slowP-1);
    const fPrev=fi>0?fast[fi-1]:null, sPrev=si>0?slow[si-1]:null;
    if(fPrev===null||sPrev===null) continue;
    const fCur=fast[fi], sCur=slow[si];
    if(fPrev<=sPrev && fCur>sCur) signals.push({type:'buy',  idx:i});
    if(fPrev>=sPrev && fCur<sCur) signals.push({type:'sell', idx:i});
  }
  return signals;
}

function atrBreakoutSignals(bars, atrPeriod, atrMult){
  const atr=computeATR_arr(bars, atrPeriod);
  const signals=[];
  for(let i=atrPeriod;i<bars.length-1;i++){
    const a=atr[i], prev=atr[i-1];
    if(a===null||prev===null) continue;
    // Buy: close breaks above prev high + ATR*mult (channel breakout)
    if(bars[i].close > bars[i-1].high + a*atrMult) signals.push({type:'buy',  idx:i});
    // Sell: close breaks below prev low - ATR*mult
    if(bars[i].close < bars[i-1].low  - a*atrMult) signals.push({type:'sell', idx:i});
  }
  return signals;
}

function bollSignals(bars, period, mult){
  const closes=bars.map(b=>b.close);
  const ma=computeSMA_arr(closes, period);
  const signals=[];
  for(let i=period;i<bars.length-1;i++){
    const idx=i-(period-1);
    if(idx<1) continue;
    let v=0;
    for(let j=i-period+1;j<=i;j++){ const d=bars[j].close-ma[idx]; v+=d*d; }
    const sd=Math.sqrt(v/period);
    const upper=ma[idx]+mult*sd, lower=ma[idx]-mult*sd;
    const prevClose=bars[i-1].close, curClose=bars[i].close;
    // Buy: price bounces off lower band (touch then move up)
    if(prevClose<=lower && curClose>lower) signals.push({type:'buy',  idx:i});
    // Sell: price reaches upper band
    if(prevClose>=upper && curClose<upper) signals.push({type:'sell', idx:i});
  }
  return signals;
}

function kdCrossSignals(bars, period){
  const {k,d}=computeKD_arr(bars, period);
  const signals=[];
  for(let i=period+1;i<bars.length-1;i++){
    const kPrev=k[i-1], dPrev=d[i-1], kCur=k[i], dCur=d[i];
    if(kPrev===null||dPrev===null) continue;
    // Golden cross (K crosses above D) in oversold zone
    if(kPrev<=dPrev && kCur>dCur && kCur<70) signals.push({type:'buy',  idx:i});
    // Death cross (K crosses below D) in overbought zone
    if(kPrev>=dPrev && kCur<dCur && kCur>30) signals.push({type:'sell', idx:i});
  }
  return signals;
}

/* ── Trade Simulation ── */
function simulateTrades(bars, signals, commission, slippage){
  const trades=[];
  const equity=[{time:bars[0].time, value:1.0}]; // normalised equity curve
  let cash=1.0, inPos=false, entryPrice=0, entryDate='', entryIdx=0;
  const signalMap=new Map();
  signals.forEach(s=>signalMap.set(s.idx, s.type));

  for(let i=0;i<bars.length;i++){
    // Execute signals from previous bar
    if(i>0){
      const sig=signalMap.get(i-1);
      if(sig==='buy' && !inPos){
        // Enter at this bar's open with cost
        entryPrice=bars[i].open*(1+commission+slippage);
        entryDate=bars[i].time;
        entryIdx=i;
        inPos=true;
      } else if((sig==='sell' || sig==='exit') && inPos){
        // Exit at this bar's open
        const exitPrice=bars[i].open*(1-commission-slippage);
        const ret=(exitPrice-entryPrice)/entryPrice;
        cash*=(1+ret);
        trades.push({
          entryDate, entryPrice:+entryPrice.toFixed(2),
          exitDate:bars[i].time, exitPrice:+exitPrice.toFixed(2),
          ret:+ret.toFixed(4),
          holdDays:i-entryIdx,
        });
        inPos=false;
      }
    }
    equity.push({time:bars[i].time, value:+cash.toFixed(4)});
  }
  // Close any open position at last bar's close
  if(inPos){
    const exitPrice=bars[bars.length-1].close*(1-commission-slippage);
    const ret=(exitPrice-entryPrice)/entryPrice;
    cash*=(1+ret);
    trades.push({
      entryDate, entryPrice:+entryPrice.toFixed(2),
      exitDate:bars[bars.length-1].time, exitPrice:+exitPrice.toFixed(2),
      ret:+ret.toFixed(4),
      holdDays:bars.length-1-entryIdx,
      open:true,
    });
  }

  // Metrics
  const totalReturn=cash-1;
  // Max Drawdown
  let peak=1, mdd=0;
  for(const pt of equity){
    if(pt.value>peak) peak=pt.value;
    const dd=(peak-pt.value)/peak;
    if(dd>mdd) mdd=dd;
  }
  const wins=trades.filter(t=>t.ret>0);
  const losses=trades.filter(t=>t.ret<0);
  const winRate=trades.length?wins.length/trades.length:0;
  const avgWin=wins.length?wins.reduce((s,t)=>s+t.ret,0)/wins.length:0;
  const avgLoss=losses.length?Math.abs(losses.reduce((s,t)=>s+t.ret,0)/losses.length):0;
  const profitFactor=avgLoss>0?(wins.reduce((s,t)=>s+t.ret,0)/Math.abs(losses.reduce((s,t)=>s+t.ret,0))):null;

  // Sharpe (annualised, using daily equity returns, rf=0)
  const dailyRets=[];
  for(let i=1;i<equity.length;i++) dailyRets.push((equity[i].value-equity[i-1].value)/equity[i-1].value);
  const meanR=dailyRets.reduce((s,r)=>s+r,0)/(dailyRets.length||1);
  const stdR=Math.sqrt(dailyRets.reduce((s,r)=>s+(r-meanR)**2,0)/(dailyRets.length||1));
  const sharpe=stdR>0?+(meanR/stdR*Math.sqrt(252)).toFixed(2):null;

  // Days for annualised return
  const days = bars.length > 1
    ? (new Date(bars[bars.length-1].time)-new Date(bars[0].time))/(1000*86400)
    : 1;
  const annReturn = days>0 ? Math.pow(cash, 365/days)-1 : totalReturn;

  // Chart markers for entries/exits
  const markers=[];
  for(const t of trades){
    markers.push({time:t.entryDate, position:'belowBar', color:'#ef5350', shape:'arrowUp',   text:'B'});
    markers.push({time:t.exitDate,  position:'aboveBar', color:'#26a69a', shape:'arrowDown', text:'S'});
  }
  markers.sort((a,b)=>a.time<b.time?-1:1);

  return {
    trades, equity, markers,
    metrics:{
      totalReturn:+totalReturn.toFixed(4),
      annReturn:  +annReturn.toFixed(4),
      mdd:        +mdd.toFixed(4),
      winRate:    +winRate.toFixed(4),
      sharpe,
      tradeCount: trades.length,
      avgWin:     +avgWin.toFixed(4),
      avgLoss:    +avgLoss.toFixed(4),
      profitFactor: profitFactor!==null?+profitFactor.toFixed(2):null,
      avgHold: trades.length?Math.round(trades.reduce((s,t)=>s+t.holdDays,0)/trades.length):0,
    }
  };
}

/* ── Entry point ── */
self.onmessage = function(e){
  const {bars, strategy, params} = e.data;
  const {commission=0.001425, slippage=0.001} = params;
  let signals=[];
  try{
    switch(strategy){
      case 'ma_cross':
        signals=maCrossSignals(bars, params.fastPeriod||5, params.slowPeriod||20);
        break;
      case 'atr_break':
        signals=atrBreakoutSignals(bars, params.atrPeriod||14, params.atrMult||1.5);
        break;
      case 'boll':
        signals=bollSignals(bars, params.bollPeriod||20, params.bollMult||2);
        break;
      case 'kd_cross':
        signals=kdCrossSignals(bars, params.kdPeriod||9);
        break;
    }
    const result=simulateTrades(bars, signals, commission, slippage);
    self.postMessage({ok:true, ...result});
  }catch(err){
    self.postMessage({ok:false, error:err.message});
  }
};
