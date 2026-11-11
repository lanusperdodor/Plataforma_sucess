// Aplica o tema antes da pintura (arquivo externo: a CSP não permite script inline).
;(function () {
  try {
    var p = localStorage.getItem('tucai:theme')
    var dark = p === 'dark' || (p !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  } catch (e) {
    document.documentElement.dataset.theme = 'light'
  }
})()
