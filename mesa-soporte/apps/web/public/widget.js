/*
 * Soporte Inncentives — "Reportar un problema" / chat button for the
 * Inncentives administrative system.
 *
 *   <script src="https://soporte.inncentives.com/widget.js" defer></script>
 *   MesaWidget.init({
 *     portal: 'https://soporte.inncentives.com',
 *     // Your backend signs the context (HS256, ≤ 15 min, see docs/integraciones/widget.md).
 *     getContextToken: () => fetch('/api/support/context-token').then((r) => r.text()),
 *     chat: true,
 *   });
 *
 * The portal opens in a new window (no iframe: the portal keeps
 * frame-ancestors 'none' and its session cookie stays first-party). The
 * token travels in the URL fragment, which is never sent to any server.
 */
(function () {
  'use strict';
  if (window.MesaWidget) return;

  function open(url) {
    var w = window.open(url, 'mesa-soporte', 'noopener,noreferrer,width=760,height=820');
    if (!w) window.location.assign(url);
  }

  function button(label, bottom, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.position = 'fixed';
    b.style.right = '16px';
    b.style.bottom = bottom + 'px';
    b.style.zIndex = '2147483000';
    b.style.padding = '10px 14px';
    b.style.border = '0';
    b.style.borderRadius = '20px';
    b.style.background = '#1d4ed8';
    b.style.color = '#fff';
    b.style.font = '600 14px system-ui, sans-serif';
    b.style.cursor = 'pointer';
    b.style.boxShadow = '0 2px 8px rgba(0,0,0,.25)';
    b.addEventListener('click', onClick);
    document.body.appendChild(b);
    return b;
  }

  window.MesaWidget = {
    init: function (opts) {
      var portal = new URL(opts.portal);
      if (portal.protocol !== 'https:' && portal.hostname !== 'localhost') {
        throw new Error('MesaWidget: the portal must use HTTPS');
      }
      var base = portal.origin;
      var lang = (opts.locale || document.documentElement.lang || 'es').slice(0, 2);
      var report = button(
        lang === 'en' ? 'Report a problem' : 'Reportar un problema',
        16,
        function () {
          report.disabled = true;
          Promise.resolve(opts.getContextToken())
            .then(function (token) {
              token = String(token || '').trim();
              if (!/^[A-Za-z0-9_.-]{20,4000}$/.test(token)) throw new Error('invalid token');
              open(base + '/reportar#ctx=' + token);
            })
            .catch(function () {
              open(base + '/tickets/nuevo');
            })
            .then(function () {
              report.disabled = false;
            });
        },
      );
      if (opts.chat) {
        button('Chat', 64, function () {
          open(base + '/chat#widget');
        });
      }
    },
  };
})();
