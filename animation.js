(() => {
  'use strict';

  if (window.AtkynAnimation) return;

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
  pill.classList.add('atk-ready');

  const DUR = 650;
  let anims = [];
  let run = 0;
  let burstStart = 0;

  function cancelAll() {
    run++;
    burstStart = 0;

    const list = anims;
    anims = [];

    for (const a of list) {
      try {
        a.cancel();
      } catch (_) {}
    }
  }

  function burstRunning() {
    return burstStart !== 0 &&
      performance.now() - burstStart < DUR;
  }

  function burst() {
    if (reduced || !aurora.animate) return;

    if (
      burstRunning() &&
      performance.now() - burstStart < DUR * 0.8
    ) {
      return;
    }

    cancelAll();

    const my = run;
    burstStart = performance.now();

    const track = (a) => {
      anims.push(a);

      const done = () => {
        if (my !== run) return;

        anims = anims.filter((x) => x !== a);

        if (!anims.length) {
          burstStart = 0;
        }
      };

      a.onfinish = done;
      a.oncancel = done;
    };

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
          easing: 'linear'
        }
      )
    );

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
          easing: 'cubic-bezier(0,0,0,1)'
        }
      )
    );

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
            easing: 'linear'
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
    pill.classList.remove('atk-expanded');
  }

  function isIdle() {
    const a = document.activeElement;

    return !(
      a === input ||
      (a && pill.contains(a))
    ) && input.value.trim() === '';
  }

  function syncClose() {
    if (
      pill.classList.contains('atk-expanded') &&
      isIdle()
    ) {
      close();
    }
  }

  input.addEventListener('focus', open);

  input.addEventListener('blur', () => {
    requestAnimationFrame(syncClose);
  });

  input.addEventListener('input', () => {
    if (isIdle()) syncClose();
  });

  if (typeof MutationObserver === 'function') {
    new MutationObserver(() => {
      requestAnimationFrame(syncClose);
    }).observe(pill, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;

    if (document.activeElement === input) {
      pill.classList.add('atk-expanded');
    } else {
      syncClose();
    }
  });

  if (document.activeElement === input) {
    pill.classList.add('atk-expanded');
  }

  window.AtkynAnimation = {
    open,
    close,
    cancel: cancelAll
  };
})();
