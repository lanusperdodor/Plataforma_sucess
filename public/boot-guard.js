// Vigia de inicialização (arquivo externo para permitir CSP sem scripts inline).
// Se um módulo falhar (rede, cache do Vite desatualizado), avisa e oferece recarregar.
;(function () {
  function fail(reason) {
    var msg = document.getElementById('boot-msg')
    var btn = document.getElementById('boot-retry')
    if (!msg || !btn) return // React já montou
    msg.textContent = 'Não foi possível carregar o Tucaí. Verifique a conexão e tente de novo.'
    btn.hidden = false
    btn.onclick = function () { location.reload() }
    if (reason) console.error('[boot] falha ao iniciar o app:', reason)
  }
  window.addEventListener('vite:preloadError', function (e) { fail(e && e.payload) })
  window.addEventListener('error', function (e) {
    var t = e && e.target
    if (t && t.tagName === 'SCRIPT') fail('script ' + t.src)
  }, true)
  setTimeout(function () { if (document.getElementById('boot')) fail('timeout de 12 s') }, 12000)
})()
