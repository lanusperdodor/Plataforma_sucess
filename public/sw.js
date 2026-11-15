/* Tucaí — service worker só para avisos (Web Push). Não guarda páginas nem intercepta requisições. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// push sem conteúdo: nenhum dado do pedido passa pelo serviço de push
self.addEventListener('push', (event) => {
  event.waitUntil(self.registration.showNotification('Nova corrida disponível', {
    body: 'Toque para ver e aceitar na Tucaí. Quem aceitar primeiro leva.',
    icon: '/brand/icone-1024.png',
    badge: '/favicon.svg',
    tag: 'tucai-corrida',
    renotify: true,
    requireInteraction: true,
    vibrate: [400, 150, 400, 150, 400],
    data: { url: '/entregador' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/entregador'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus()
        if ('navigate' in c) await c.navigate(url).catch(() => undefined)
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})
