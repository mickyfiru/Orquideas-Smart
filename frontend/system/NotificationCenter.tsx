import { useEffect, useRef, useState } from 'react'
import { Bell, BellRing, CalendarDays, Check, CircleAlert, Usb, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { NotificationInbox, NotificationItem } from '../../shared/alerts.ts'
import { subscribeTelemetry } from '../telemetrySocket.ts'
import { irrigationDate } from '../irrigation/api.ts'
import { browserPermission, itemKey, noticeTitle, notifyBrowser } from './browserNotifications.ts'
import { systemRequest } from './api.ts'

const category = {
  irrigation: { label: 'Riego', Icon: CalendarDays },
  environment: { label: 'Alerta ambiental', Icon: CircleAlert },
  connection: { label: 'Conexión', Icon: Usb },
}

export function NotificationCenter() {
  const [revision, setRevision] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [inbox, setInbox] = useState<NotificationInbox | null>(null)
  const [open, setOpen] = useState(false)
  const [permission, setPermission] = useState(browserPermission)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const seen = useRef<Set<string> | null>(null)

  useEffect(() => subscribeTelemetry(data => setRevision(data ? data.irrigationRevision + data.alertsRevision : '')), [])
  useEffect(() => {
    const controller = new AbortController()
    void systemRequest<NotificationInbox>('/notifications', { signal: controller.signal }).then(incoming => {
      if (controller.signal.aborted) return
      const previous = seen.current
      seen.current = new Set(incoming.recent.map(itemKey))
      setInbox(incoming)
      setError('')
      const fresh = (items: NotificationItem[]) => previous ? items.filter(item => item.readAt === null && !previous.has(itemKey(item))) : []
      const visible = fresh(incoming.items)
      const browser = fresh(incoming.recent).filter(item => item.kind !== 'irrigation' || incoming.preferences.irrigation)
      if (visible.length) setNotice(visible.length === 1 ? noticeTitle(visible[0]) : `Tienes ${visible.length} avisos nuevos.`)
      if (browser.length && incoming.preferences.browser && browserPermission() === 'granted') notifyBrowser(browser[0], browser.length)
    }).catch(() => {
      if (!controller.signal.aborted) setError('No se pudieron consultar las notificaciones.')
    })
    return () => controller.abort()
  }, [revision, open, refresh])

  async function markRead(item: NotificationItem) {
    setBusy(true)
    try {
      const path = item.kind === 'irrigation' ? '/irrigation/notifications' : '/alerts'
      await systemRequest(`${path}/${item.id}/read`, { method: 'PATCH' })
      setRefresh(value => value + 1)
    } catch (failure) { setError((failure as Error).message) }
    finally { setBusy(false) }
  }

  const unread = inbox?.unread ?? 0
  return <div className="reminder-center">
    <button className="icon-button reminder-toggle" aria-label={unread ? `Notificaciones, ${unread} sin leer` : 'Notificaciones'}
      aria-expanded={open} aria-controls="reminder-panel" onClick={() => { setOpen(!open); setNotice(''); setPermission(browserPermission()) }}>
      <Bell size={19} />{unread > 0 && <span>{unread > 99 ? '99+' : unread}</span>}
    </button>
    {notice && <div className="reminder-toast panel" role="status"><BellRing size={17} /><span>{notice}</span>
      <button className="icon-button" aria-label="Cerrar aviso" onClick={() => setNotice('')}><X size={15} /></button></div>}
    {open && <section id="reminder-panel" className="reminder-panel panel" aria-label="Notificaciones">
      <div className="irrigation-heading"><h2>Notificaciones</h2>
        <button className="icon-button" aria-label="Cerrar notificaciones" onClick={() => setOpen(false)}><X size={17} /></button></div>
      <p className="irrigation-muted">Los avisos del navegador requieren permiso y la aplicación abierta.</p>
      {inbox?.preferences.browser && permission === 'default' && <button className="irrigation-button" onClick={async () => {
        try { setPermission(await Notification.requestPermission()) } catch { setError('El navegador no pudo solicitar el permiso.') }
      }}>Activar avisos del navegador</button>}
      {permission === 'denied' && <p className="irrigation-muted">Permiso bloqueado en la configuración del sitio.</p>}
      {error && <p className="irrigation-error" role="alert">{error}</p>}
      <div className="reminder-list">
        {inbox?.items.map(item => {
          const { Icon, label } = category[item.kind]
          return <article className={item.readAt === null ? 'reminder-item unread' : 'reminder-item'} key={itemKey(item)}>
            <div><span className={`notification-category ${item.kind}`}><Icon size={13} />{label}</span>
              <strong>{item.title}</strong><p>{irrigationDate.format(item.scheduledAt ?? item.time)} · {item.detail}</p></div>
            {item.readAt === null ? <button className="icon-button" aria-label={`Marcar como leído: ${item.title}`} disabled={busy}
              onClick={() => void markRead(item)}><Check size={17} /></button> : <small>Leído</small>}</article>
        })}
        {inbox?.items.length === 0 && <p className="irrigation-muted">No hay avisos visibles.</p>}
        {!inbox && !error && <p className="irrigation-muted">Cargando avisos…</p>}
      </div>
      <div className="notification-links"><Link to="/calendario" className="text-link" onClick={() => setOpen(false)}>Calendario</Link>
        <Link to="/alertas" className="text-link" onClick={() => setOpen(false)}>Historial de alertas</Link></div>
    </section>}
  </div>
}
