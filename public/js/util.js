// Small shared helpers: UTC-safe date-string math, number formatting, DOM creation.

export const DAY_MS = 86400000;

export function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return t;
}
export function fmtDate(t) {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
export function addDays(s, n) { return fmtDate(parseDate(s) + n * DAY_MS); }
export function diffDays(a, b) { return Math.round((parseDate(b) - parseDate(a)) / DAY_MS); }
export function weekday(s) { return new Date(parseDate(s)).getUTCDay(); }
export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function daysInMonth(y, m0) { return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate(); }

const longDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
const medDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
const shortDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const monthName = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' });
export const fmtLong = (s) => longDate.format(parseDate(s));
export const fmtMed = (s) => medDate.format(parseDate(s));
export const fmtShort = (s) => shortDate.format(parseDate(s));
export const fmtMonth = (s) => monthName.format(parseDate(s));

const intFmt = new Intl.NumberFormat('en-US');
const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
export const fmtInt = (n) => intFmt.format(Math.round(n));
export function fmtCompact(n) { return Math.abs(n) < 1000 ? fmtNum(n) : compactFmt.format(n); }
export function fmtNum(n) {
  if (n === 0) return '0';
  const a = Math.abs(n);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: a < 10 ? 1 : 0 }).format(n);
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** el('div', {class:'x', text:'..'}, child, ...) -- text always via textContent. */
export function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'text') n.textContent = v;
    else if (k === 'class') n.className = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) if (c != null) n.append(c);
  return n;
}

export function safeStorage() {
  return {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };
}
