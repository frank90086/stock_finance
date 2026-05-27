# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A single-file static web app for Taiwan stock technical analysis, deployed to GitHub Pages at `stock.cafaemon.com`. The entire application lives in `index.html` — no build step, no dependencies to install, no package manager.

## Development

Open `index.html` directly in a browser, or serve it locally:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

To deploy: push to `main` — GitHub Pages auto-publishes.

## Architecture

Everything is in a single `<script>` block inside `index.html`. The logical layers are:

**Data fetching** (`loadData`, `fetchViaProxy`, `loadStockList`)
- TWSE STOCK_DAY API is fetched month-by-month and routed through a cascade of public CORS proxies (`PROXIES` array: allorigins → corsproxy → codetabs → thingproxy)
- The first working proxy is used for all subsequent monthly requests in parallel
- Stock list (code ↔ name) is fetched live from TWSE/TPEX OpenAPI on boot; `FALLBACK_LIST` covers popular stocks if the live fetch fails
- Dates from TWSE are ROC calendar strings (e.g., `115/05/02`) and converted to ISO via `rocToISO()`

**Indicator computation** (pure functions on `bars` arrays)
- `computeATR(bars, period)` — Wilder smoothing (not simple average)
- `computeSMA(bars, period)` — simple moving average on close
- `computeBoll(bars, period, mult)` — Bollinger Bands (default 20, 2σ)

**Rendering** (`render`, `applyOverlays`, `buildStrategy`)
- `render()` is the single entry point after data loads: sets all chart data, updates stats, calls `buildStrategy()`
- `applyOverlays()` re-applies MA/Bollinger series based on the `toggles` state object — called on indicator toggle without re-fetching data; uses `lastBars` cache
- Two `LightweightCharts` instances (`priceChart`, `atrChart`) are synced via `syncTimeScales()` and crosshair position bridging using `atrMap7`, `atrMap14`, `ohlcMap` lookup maps
- `buildStrategy()` renders the ATR stop-loss/take-profit table and Bollinger Band playbook using current price and ATR(14)

**UI wiring** (`wireControls`, `initCharts`)
- Range selector (3/6/12 months) re-calls `run()` with new `months` value
- Indicator toggles mutate `toggles` object and call `applyOverlays()`
- Stock search uses `searchStocks()` with scored fuzzy matching (exact → prefix → contains → subsequence)

## Key Conventions

- Taiwan stock convention: **red = up, green = down** (`COLORS.up = #ef5350` red, `COLORS.down = #26a69a` teal)
- UI language is Traditional Chinese (zh-Hant)
- ATR(7) is the fast/sensitive line; ATR(14) is Wilder's original and used for strategy calculations
- Strategy stop-loss defaults: 1.5×ATR (tight), 2×ATR (standard), 3×ATR (wide)
- LightweightCharts v4.1.3 loaded from CDN with three fallbacks (jsdelivr → unpkg → cdnjs)
