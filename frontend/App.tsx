import { useState } from 'react'
import { Activity, Bell, CalendarDays, ChevronRight, CircuitBoard, Flower2, History, LayoutDashboard, Menu, Settings, X } from 'lucide-react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { Dashboard } from './dashboard/Dashboard.tsx'
import { IrrigationCalendar } from './irrigation/IrrigationCalendar.tsx'
import { NotificationCenter } from './system/NotificationCenter.tsx'
import { Alerts } from './system/Alerts.tsx'
import { SettingsPage } from './system/Settings.tsx'
import { Sensors } from './sensors/Sensors.tsx'
import { Monitoring } from './sensors/Monitoring.tsx'
import { EnvironmentalHistory } from './history/EnvironmentalHistory.tsx'

const modules = [
  { path: '/', label: 'Resumen', icon: LayoutDashboard },
  { path: '/calendario', label: 'Calendario de riego', icon: CalendarDays },
  { path: '/sensores', label: 'Sensores', icon: CircuitBoard },
  { path: '/monitoreo', label: 'Monitoreo ambiental', icon: Activity },
  { path: '/historial', label: 'Historial', icon: History },
  { path: '/alertas', label: 'Alertas', icon: Bell },
  { path: '/configuracion', label: 'Configuración', icon: Settings },
]

export function App() {
  const [menu, setMenu] = useState(false)
  const location = useLocation()
  const pathname = location.pathname.replace(/\/$/, '') || '/'
  const current = modules.find(module => module.path === pathname)
  return (
    <div className="shell" onKeyDown={event => { if (event.key === 'Escape') setMenu(false) }}>
      {menu && <button className="scrim" aria-label="Cerrar navegación" onClick={() => setMenu(false)} />}
      <aside className={menu ? 'sidebar open' : 'sidebar'} id="sidebar">
        <Link to="/" className="brand" onClick={() => setMenu(false)}>
          <span className="brand-icon"><Flower2 size={24} /></span>
          <span><strong>Orquídeas<span> Smart</span></strong><small>Monitoreo de invernadero</small></span>
        </Link>
        <nav aria-label="Navegación principal">
          {modules.map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={path} end onClick={() => setMenu(false)}>
              <Icon size={18} />{label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="school-icon"><Flower2 size={17} /></span>
          <div><strong>Proyecto universitario</strong><small>Santo Tomás</small></div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button className="menu-button" aria-expanded={menu} aria-controls="sidebar"
            aria-label={menu ? 'Cerrar navegación' : 'Abrir navegación'} onClick={() => setMenu(!menu)}>
            {menu ? <X size={22} /> : <Menu size={22} />}
          </button>
          <div className="breadcrumb"><span>Invernadero</span><ChevronRight size={14} /><strong>{current?.label ?? 'Página no encontrada'}</strong></div>
          <NotificationCenter />
        </header>
        <main className="content">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="/calendario" element={<IrrigationCalendar />} />
            <Route path="/sensores" element={<Sensors />} />
            <Route path="/monitoreo" element={<Monitoring />} />
            <Route path="/historial" element={<EnvironmentalHistory />} />
            <Route path="/alertas" element={<Alerts />} />
            <Route path="/configuracion" element={<SettingsPage />} />
            <Route path="*" element={<section className="placeholder panel"><h1>Página no encontrada</h1><Link className="text-link" to="/">Volver al resumen</Link></section>} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
