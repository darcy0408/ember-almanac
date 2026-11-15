// One shared tooltip element. Pointer hover and keyboard focus show it; Escape hides it.
// (The native interestfor/popover=hint is not Baseline-widely-available yet, so this is the fallback path.)
let tip = null;
let current = null;

function ensure() {
  if (!tip) {
    tip = document.getElementById('tip');
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });
    window.addEventListener('scroll', hideTip, true);
  }
  return tip;
}

/** lines: [{label, value}] plus optional title. Built with textContent only. */
export function showTip(target, title, rows, opts = {}) {
  const t = ensure();
  t.replaceChildren();
  const h = document.createElement('div');
  h.className = 'tip-title';
  h.textContent = title;
  t.append(h);
  for (const [k, v, swatch] of rows) {
    const row = document.createElement('div');
    row.className = 'tip-row';
    if (swatch) { const s = document.createElement('i'); s.className = 'sw ' + swatch; s.setAttribute('aria-hidden', 'true'); row.append(s); }
    const a = document.createElement('span'); a.textContent = k;
    const b = document.createElement('span'); b.className = 'tip-val'; b.textContent = v;
    if (opts.valueFirst) { row.classList.add('tip-vfirst'); row.append(b, a); } else row.append(a, b);
    t.append(row);
  }
  t.hidden = false;
  current = target;
  const r = target.getBoundingClientRect();
  const tw = t.offsetWidth, th = t.offsetHeight;
  let x = r.left + r.width / 2 - tw / 2;
  x = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
  let y = r.top - th - 8;
  if (y < 8) y = r.bottom + 8;
  t.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

export function hideTip(target) {
  if (!tip) ensure();
  if (target && target !== current) return;
  tip.hidden = true;
  current = null;
}
