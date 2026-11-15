self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const app = clients.find(client => client.url.startsWith(self.registration.scope))
    const path = event.notification.data?.path === '/alertas' ? 'alertas' : 'calendario'
    return app ? app.focus() : self.clients.openWindow(new URL(path, self.registration.scope).href)
  }))
})
