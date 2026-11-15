import type { NotificationItem } from '../../shared/alerts.ts'
import { irrigationDate } from '../irrigation/api.ts'

export const browserPermission = () => window.isSecureContext && 'Notification' in window ? Notification.permission : 'unavailable'
export const itemKey = (item: NotificationItem) => `${item.kind}-${item.id}`
export const noticeTitle = (item: NotificationItem) => item.kind === 'irrigation' ? `Es hora de regar: ${item.title}` : item.title

export function notifyBrowser(item: NotificationItem, count: number) {
  const title = count > 1 ? `${count} avisos de Orquídeas Smart` : item.kind === 'irrigation' ? 'Recordatorio de riego' : item.title
  const options = {
    body: `${item.kind === 'irrigation' ? item.title : item.detail} · ${irrigationDate.format(item.scheduledAt ?? item.time)}`,
    tag: 'orquideas-' + itemKey(item), data: { path: item.kind === 'irrigation' ? '/calendario' : '/alertas' },
  }
  try {
    const notice = new Notification(title, options)
    notice.onclick = () => { window.focus(); notice.close() }
  } catch {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/riego-notificaciones.js')
        .then(() => navigator.serviceWorker.ready)
        .then(worker => worker.showNotification(title, options))
        .catch(error => console.warn('El navegador no pudo mostrar el aviso.', error))
    }
  }
}
