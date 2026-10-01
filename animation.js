(() => {
  'use strict';

  if (window.AtkynAnimation) return; /* no double init */

  const pill = document.getElementById('pill');
  const input = document.getElementById('cbInput');
  if (!pill || !input) return;

  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = !!(mq && mq.matches);
  if (mq) {
    const onChange = (e) => { reduced = !!e.matches; if (reduced) cancelAll(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* Visual layers: behind content, pointer-events none (see CSS) */
  const mk = (cls, parent) => {
    const el = document.createElement('div');
    el.className = cls;
    parent.appendChild(el);
    return el;
  };
  const fill = document.createElement('div');
  fill.className = 'atk-fill';
  fill.setAttribute('aria-hidden', 'true');
  const aurora = document.createElement('div');
  aurora.className = 'atk-aurora';
  aurora.setAttribute('aria-hidden', 'true');
  const blurs = [];
  for (let i = 0; i < 2; i++) {
    const b = mk('atk-aurora-blur', aurora);
    const m = mk('atk-aurora-mask', b);
    mk('atk-aurora-wheel', m);
    blurs.push(b);
  }
  pill.insertBefore(aurora, pill.firstChild);
  pill.insertBefore(fill, pill.firstChild);

  const DUR = 1350;
  let anims = [];
  let run = 0; /* latest-wins token */
  let fadeTimer = 0;
  let lastBurst = 0;

  /* Promote layers to the compositor only while animating (no first-frame jank, no idle memory cost) */
  function setHints(on) {
    try {
      aurora.style.willChange = on ? 'opacity' : '';
      for (const b of blurs) b.style.willChange = on ? 'filter' : '';
    } catch (_) {}
  }

  function cancelAll() {
    run++;
    const list = anims;
    anims = [];
    clearTimeout(fadeTimer);
    pill.classList.remove('atk-animating');
    setHints(false);
    for (const a of list) { try { a.cancel(); } catch (_) {} }
  }

  function burst() {
    /* dedupe: send + blur/close can fire together, don't restart mid-animation */
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (anims.length && now - lastBurst < 400) return;
    lastBurst = now;
    cancelAll();
    if (reduced || !aurora.animate) return;
    const my = run;
    pill.classList.add('atk-animating'); /* outline hidden while aurora plays */
    setHints(true);
    /* outline starts fading back in while aurora is still fading out (crossfade) */
    fadeTimer = setTimeout(() => {
      if (my === run) pill.classList.remove('atk-animating');
    }, DUR * 0.75);
    const track = (a) => {
      anims.push(a);
      a.onfinish = a.oncancel = () => {
        if (my !== run) return; /* stale: newer run owns state */
        anims = anims.filter((x) => x !== a);
        /* all aurora animations done -> outline comes back */
        if (anims.length === 0) {
          pill.classList.remove('atk-animating');
          setHints(false);
        }
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
        { '--atk-a-grad': '170deg', '--atk-a-mask': '-90deg' },
        { '--atk-a-grad': '225deg', '--atk-a-mask': '200deg' }
      ], { duration: DUR, easing: 'cubic-bezier(0.22,0.6,0.3,1)', fill: 'none' }));

      /* blur: 1 → 13 → 8 → 10 → 5 → 2 px (soft, no sharp snap at the end) */
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
    } catch (_) {
      /* animation API failed: never leave the outline hidden */
      cancelAll();
    }
  }

  function open() {
    pill.classList.add('atk-expanded');
    burst();
  }

  function close() {
    const wasExpanded = pill.classList.contains('atk-expanded');
    pill.classList.remove('atk-expanded');
    if (wasExpanded) burst(); /* same aurora on close */
    else cancelAll();
  }

  input.addEventListener('focus', open);
  input.addEventListener('blur', () => {
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (a === input || (a && pill.contains(a))) return;
      if (input.value.trim() !== '') return; /* never collapse with typed text */
      close();
    });
  });

  /* Message send: aurora plays again */
  pill.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.send-btn');
    if (btn && !btn.classList.contains('cross-mode')) burst();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && input.value.trim() !== '') burst();
  });

  /* Page / URL load: aurora plays as the chatbar settles at the bottom */
  const onLoadBurst = () => requestAnimationFrame(() => requestAnimationFrame(burst));
  if (document.readyState === 'complete') onLoadBurst();
  else window.addEventListener('load', onLoadBurst, { once: true });
  window.addEventListener('pageshow', (e) => { if (e.persisted) onLoadBurst(); });
  window.addEventListener('popstate', onLoadBurst);
  window.addEventListener('hashchange', onLoadBurst);

  if (document.activeElement === input) open();

  window.AtkynAnimation = { open, close, burst, cancel: cancelAll };
})();
 
