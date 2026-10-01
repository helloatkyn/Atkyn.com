(() => {
  'use strict';

  if (window.AtkynHomeAurora) return; /* no double init */

  const host = document.getElementById('homePill'); /* .search-wrap */
  const bar = host && host.querySelector('.search-pill');
  if (!host || !bar) return;

  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = !!(mq && mq.matches);
  if (mq) {
    const onChange = (e) => { reduced = !!e.matches; if (reduced) cancelAll(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  const DUR = 600;
  let aurora = null;
  let blurs = [];
  let anims = [];
  let run = 0; /* latest-wins token */
  let fadeTimer = 0;
  let lastBurst = 0;

  function cancelAll() {
    run++;
    const list = anims;
    anims = [];
    clearTimeout(fadeTimer);
    for (const a of list) { try { a.cancel(); } catch (_) {} }
    if (aurora) { aurora.remove(); aurora = null; blurs = []; } /* removes the will-change hints with it */
    host.classList.remove('hsa-animating', 'hsa-lift');
  }

  function build() {
    const el = document.createElement('div');
    el.className = 'hsa-aurora';
    el.setAttribute('aria-hidden', 'true');
    const list = [];
    for (let i = 0; i < 2; i++) {
      const b = document.createElement('div');
      b.className = 'hsa-blur';
      const m = document.createElement('div');
      m.className = 'hsa-mask';
      const w = document.createElement('div');
      w.className = 'hsa-wheel';
      m.appendChild(w);
      b.appendChild(m);
      el.appendChild(b);
      list.push(b);
    }
    host.insertBefore(el, host.firstChild);
    aurora = el;
    blurs = list;
  }

  function burst() {
    /* dedupe: rapid taps never restart a running burst */
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (anims.length && now - lastBurst < 400) return;
    lastBurst = now;
    cancelAll();
    if (reduced || !host.animate) return;
    const my = run;

    build();
    aurora.style.willChange = 'opacity';
    for (const b of blurs) b.style.willChange = 'filter';
    host.classList.add('hsa-animating', 'hsa-lift');

    /* outline starts fading back in while aurora is still fading out (crossfade) */
    fadeTimer = setTimeout(() => {
      if (my === run) host.classList.remove('hsa-animating');
    }, DUR * 0.75);

    const track = (a) => {
      anims.push(a);
      a.onfinish = a.oncancel = () => {
        if (my !== run) return; /* stale: newer run owns state */
        anims = anims.filter((x) => x !== a);
        if (anims.length === 0) cancelAll();
      };
      return a;
    };

    try {
      /* opacity: smooth fade in (22%) → hold (42%) → long ease-in-out fade out */
      track(aurora.animate([
        { opacity: 0, offset: 0, easing: 'cubic-bezier(0.22,0.61,0.36,1)' },
        { opacity: 1, offset: 0.22, easing: 'linear' },
        { opacity: 1, offset: 0.42, easing: 'cubic-bezier(0.45,0,0.55,1)' },
        { opacity: 0, offset: 1 }
      ], { duration: DUR, easing: 'linear', fill: 'none' }));

      /* angle sweep */
      track(aurora.animate([
        { '--hsa-grad': '170deg', '--hsa-mask': '-90deg' },
        { '--hsa-grad': '225deg', '--hsa-mask': '200deg' }
      ], { duration: DUR, easing: 'cubic-bezier(0.22,0.6,0.3,1)', fill: 'none' }));

      /* blur: 1 → 13 → 8 → 10 → 5 → 2 px */
      for (const b of blurs) {
        track(b.animate([
          { filter: 'blur(1px)', offset: 0, easing: 'ease-in-out' },
          { filter: 'blur(13px)', offset: 0.14, easing: 'ease-in-out' },
          { filter: 'blur(8px)', offset: 0.3, easing: 'ease-in-out' },
          { filter: 'blur(10px)', offset: 0.5, easing: 'ease-in-out' },
          { filter: 'blur(5px)', offset: 0.78, easing: 'ease-in-out' },
          { filter: 'blur(2px)', offset: 1 }
        ], { duration: DUR, easing: 'linear', fill: 'none' }));
      }

      /* Home only: the lifted pill fades out with the burst so it never pops away
         when the Search Screen takes over */
      track(host.animate([
        { opacity: 1, offset: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 1 }
      ], { duration: DUR, easing: 'linear', fill: 'forwards' }));
    } catch (_) {
      /* animation API failed: never leave the outline hidden */
      cancelAll();
    }
  }

  host.addEventListener('click', burst);

  window.AtkynHomeAurora = { burst, cancel: cancelAll };
})();
