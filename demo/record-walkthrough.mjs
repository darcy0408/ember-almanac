import { chromium } from 'playwright-core';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
const W = 1280, H = 720;
rmSync('vid', { recursive: true, force: true }); mkdirSync('vid');
const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: W, height: H }, colorScheme: 'dark', deviceScaleFactor: 1, recordVideo: { dir: 'vid', size: { width: W, height: H } } });
const p = await ctx.newPage();
const t00 = Date.now();
await p.goto('http://localhost:8787/#c=20017&r=12m&from=2025-11-15&to=2026-11-14');
await p.waitForFunction(() => document.getElementById('progress')?.hidden !== false && !document.getElementById('results-body')?.hidden, null, { timeout: 180000 });
await p.waitForTimeout(1500);
// fake cursor + click ripple
await p.evaluate(() => {
  const c = document.createElement('div'); c.id = '__cur';
  c.style.cssText = 'position:fixed;z-index:99999;left:0;top:0;width:22px;height:22px;margin:-3px 0 0 -3px;pointer-events:none;transform:translate(640px,300px);background:no-repeat url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l14 8-6.2 1.6L8.6 18z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>') + '")';
  document.body.append(c);
  addEventListener('mousemove', (e) => { c.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; }, true);
  addEventListener('mousedown', (e) => {
    const r = document.createElement('div');
    r.style.cssText = `position:fixed;z-index:99998;left:${e.clientX - 18}px;top:${e.clientY - 18}px;width:36px;height:36px;border-radius:50%;border:3px solid #ff9769;pointer-events:none;transition:transform .45s ease-out,opacity .45s ease-out`;
    document.body.append(r); requestAnimationFrame(() => { r.style.transform = 'scale(1.9)'; r.style.opacity = '0'; }); setTimeout(() => r.remove(), 500);
  }, true);
  window.__scroll = (y, ms) => new Promise((res) => { const y0 = scrollY, t0 = performance.now(); const f = (t) => { const k = Math.min(1, (t - t0) / ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; scrollTo(0, y0 + (y - y0) * e); k < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
});
let cx = 640, cy = 300;
async function move(x, y, ms = 600) { const n = Math.max(8, Math.round(ms / 16)); for (let i = 1; i <= n; i++) { const k = i / n, e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; await p.mouse.move(cx + (x - cx) * e, cy + (y - cy) * e); await p.waitForTimeout(ms / n); } cx = x; cy = y; }
const center = async (loc) => { const r = await loc.boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2]; };
const topOf = (sel, off = 16) => p.evaluate(([s, o]) => { const el = typeof s === 'string' && s.startsWith('h:') ? [...document.querySelectorAll('#evidence h3')].find((h) => h.textContent.includes(s.slice(2))).closest('.card') : document.querySelector(s); return Math.max(0, el.getBoundingClientRect().top + scrollY - o); }, [sel, off]);
const scroll = (y, ms) => p.evaluate(([y, ms]) => window.__scroll(y, ms), [y, ms]);
await p.evaluate(() => scrollTo(0, 0)); await p.mouse.move(cx, cy); await p.waitForTimeout(600);

const T0 = Date.now(); const cues = []; const cue = (n) => { cues.push([n, (Date.now() - T0) / 1000]); };
const until = async (s) => { const d = T0 + s * 1000 - Date.now(); if (d > 0) await p.waitForTimeout(d); else console.log('late by', -d, 'ms at', s); };

cue('1 open');                                   // 0-3.5: click Load example
await p.waitForTimeout(700);
await move(...(await center(p.locator('#example-link'))), 900); await p.waitForTimeout(250);
await p.mouse.down(); await p.mouse.up();
await p.waitForSelector('#evidence .ev-headline', { timeout: 10000 });
await move(520, 300, 700);
await until(3.5); cue('2 headline');              // 3.5-10.5: headline
await move(700, 262, 1000);
await until(8.5); cue('3 raw');                  // 10.5-15: raw detections
await scroll(await topOf('h:Raw detections'), 850);
{ const r = await p.locator('#evidence .ev-card').nth(0).boundingBox(); await move(r.x + r.width * 0.33, r.y + r.height * 0.5, 800); await move(r.x + r.width * 0.93, r.y + r.height * 0.5, 1100); }
await until(12.2); cue('4 index');                  // 15-21: indexed chart, then table
await scroll(await topOf('h:each sensor indexed'), 850);
{ const r = await p.locator('#evidence .ev-card').nth(1).boundingBox(); await move(r.x + r.width * 0.1, r.y + r.height * 0.55, 600); await move(r.x + r.width * 0.93, r.y + r.height * 0.55, 1400); }
await scroll(await topOf('h:Does putting both'), 800);
await until(16.5); cue('5 calendar');               // 21-26: historical calendar
await scroll(await topOf('h:historical calendar', 120), 850);
{ const pts = await p.evaluate(() => { const bs = [...document.querySelectorAll('#evidence .hm-grid button')].map((b) => b.getBoundingClientRect()); const xs = [...new Set(bs.map((r) => Math.round(r.x)))].sort((a, b) => a - b); const x = xs[14]; const col = bs.filter((r) => Math.round(r.x) === x).sort((a, b) => a.y - b.y); return [col[0], col[col.length - 1]].map((r) => [r.x + r.width / 2, r.y + r.height / 2]); });
  await move(pts[0][0], pts[0][1], 700); await move(pts[1][0], pts[1][1], 1100); }
await until(20.5); cue('6 phoenix');                // 24.2-31.5: switch example to Maricopa (Phoenix)
await scroll(await topOf('#ev-picker', 140), 600);
await move(...(await center(p.locator('#ev-picker'))), 600);
await p.evaluate(([x, y]) => dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y })), [cx, cy]);
await p.waitForTimeout(300);
await p.selectOption('#ev-picker', '04013');
await p.waitForFunction(() => document.querySelector('#evidence .ev-headline')?.textContent.includes('65%'), null, { timeout: 10000 });
await scroll(await topOf('#evidence .ev-headline', 140), 500);
{ const r = await p.locator('#evidence .ev-headline').boundingBox(); await move(r.x + r.width * 0.2, r.y + r.height * 0.4, 500); await move(r.x + r.width * 0.7, r.y + r.height * 0.4, 1100); }
await until(25.5); cue('7 live');                   // 31.5-37.5: live explorer day -> map
await scroll(await topOf('#cal-card', 200), 900);
{ const day = p.locator('.cal-cell[data-date="2026-04-07"]'); await move(...(await center(day)), 500); await p.mouse.down(); await p.mouse.up(); }
await p.waitForTimeout(350);
await scroll(await topOf('#map', 60), 900);
await move(760, 330, 600);
await until(29.5); cue('end');
const startOffset = (T0 - t00) / 1000;
await ctx.close(); const path = await p.video().path(); await b.close();
writeFileSync('cues.json', JSON.stringify({ startOffset, cues, path }, null, 1));
console.log(JSON.stringify({ startOffset, cues, path }));
