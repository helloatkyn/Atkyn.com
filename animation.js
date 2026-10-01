/* ATKYN — isolated visual animation layer
 *
 * core.js owns keyboard/viewport geometry. This file owns visuals only:
 * aurora burst (1.0s) + expanded/compact rim state on #pill.
 * Never touches .chatbar-wrap, VisualViewport, spacer or keyboard state.
 * Timing/keyframes ported from the Google Search capture.
 */
(() => {
  'use strict';

  if (window.AtkynAnimation) return; /* no double init */

  const pill = document.getElementById('pill');
  const input = document.getElementById('cbInput');
  if (!pill || !input) return;

  const mq = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  let reduced = !!(mq && mq.matches);

  if (mq) {
    const onChange = (e) => {
      reduced = !!e.matches;
      if (reduced) cancelAll();
    };

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

  /* ATKYN animation duration */
  const DUR = 1000;

  let anims = [];
  let run = 0; /* latest-wins token */

  function cancelAll() {
    run++;

    const list = anims;
    anims = [];

    for (const a of list) {
      try {
        a.cancel();
      } catch (_) {}
    }
  }

  function burst() {
    cancelAll();

    if (reduced || !aurora.animate) return;

    const my = run;

    const track = (a) => {
      anims.push(a);

      a.onfinish = a.oncancel = () => {
        if (my !== run) return; /* stale: newer run owns state */

        anims = anims.filter((x) => x !== a);
      };

      return a;
    };

    /* opacity: 0 → 1 (25%) → 1 (50%) → 0 */
    track(
      aurora.animate(
        [
          {
            opacity: 0,
            offset: 0,
            easing: 'cubic-bezier(0,0,0,1)'
          },
          {
            opacity: 1,
            offset: 0.25
          },
          {
            opacity: 1,
            offset: 0.5,
            easing: 'cubic-bezier(0.3,0,0.8,0.15)'
          },
          {
            opacity: 0,
            offset: 1
          }
        ],
        {
          duration: DUR,
          easing: 'linear',
          fill: 'none'
        }
      )
    );

    /* angle sweep */
    track(
      aurora.animate(
        [
          {
            '--atk-a-grad': '170deg',
            '--atk-a-mask': '-90deg'
          },
          {
            '--atk-a-grad': '225deg',
            '--atk-a-mask': '200deg'
          }
        ],
        {
          duration: DUR,
          easing: 'cubic-bezier(0,0,0,1)',
          fill: 'none'
        }
      )
    );

    /* blur: 1 → 10 → 5 → 7 → 1 px */
    for (const b of blurs) {
      track(
        b.animate(
          [
            {
              filter: 'blur(1px)',
              offset: 0
            },
            {
              filter: 'blur(10px)',
              offset: 0.15
            },
            {
              filter: 'blur(5px)',
              offset: 0.25
            },
            {
              filter: 'blur(7px)',
              offset: 0.45
            },
            {
              filter: 'blur(1px)',
              offset: 1
            }
          ],
          {
            duration: DUR,
            easing: 'linear',
            fill: 'none'
          }
        )
      );
    }
  }

  function open() {
    pill.classList.add('atk-expanded');
    burst();
  }

  function close() {
    cancelAll();
    pill.classList.remove('atk-expanded');
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

  if (document.activeElement === input) open();

  window.AtkynAnimation = {
    open,
    close,
    cancel: cancelAll
  };
})();
