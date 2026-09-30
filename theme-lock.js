/* Atkyn theme lock — load in <head>, AFTER the theme-color <meta> and highlight.js <link> tags.
   Locks the rendered theme once per page load. System theme changes while the page is
   open are only recorded (atkyn_pending_theme, see core.js) and apply on next launch. */
(function () {
  var root = document.documentElement;
  var locked = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

  /* Pending value is consumed here; the current system theme is authoritative,
     and nothing ever calls location.reload(), so no reload loop is possible. */
  try { localStorage.removeItem('atkyn_pending_theme'); } catch (e) {}

  root.dataset.lockedTheme = locked;

  function pin(el, text) {
    var media = el.getAttribute('media') || '';
    if (media.indexOf('dark') !== -1) el.setAttribute('media', locked === 'dark' ? 'all' : 'not all');
    else if (media.indexOf('light') !== -1) el.setAttribute('media', locked === 'light' ? 'all' : 'not all');
  }

  Array.prototype.forEach.call(document.querySelectorAll('meta[name="theme-color"]'), pin);
  Array.prototype.forEach.call(document.querySelectorAll('link[href*="atom-one-"]'), pin);
})();
