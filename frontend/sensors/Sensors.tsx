import { useEffect, useState } from 'react'
import { Cable, CircuitBoard, FlaskConical, RefreshCw, Search, Usb } from 'lucide-react'
import type { Measurement, Mode, RegisteredSensor, SerialPortOption } from '../../shared/telemetry.ts'
import { formatReadingTime } from '../dashboard/ClimateChart.tsx'
import { useTelemetry } from '../dashboard/useTelemetry.ts'
import { sensorRequest } from './api.ts'
import { connectionLabels, formatNumber } from './status.ts'
import './sensors.css'

type InventorySensor = RegisteredSensor & { latest: Measurement | null }
const time = (when: number | null | undefined) => when ? formatReadingTime(when) : 'Sin registro'

export function Sensors() {
  const { snapshot, transport } = useTelemetry(null)
  const mode = snapshot?.mode
  const [inventory, setInventory] = useState<InventorySensor[] | null>(null)
  const [ports, setPorts] = useState<SerialPortOption[] | null>(null)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [inventoryError, setInventoryError] = useState('')
  const [message, setMessage] = useState('')
  const serial = snapshot?.serial
  const path = selected || (ports?.some(port => port.path === serial?.path) ? serial?.path : '') || ''
  const offline = transport !== 'online'

  useEffect(() => {
    const controller = new AbortController()
    if (transport !== 'offline') {
      void sensorRequest<InventorySensor[]>('', 'GET', undefined, controller.signal).then(devices => {
        if (!controller.signal.aborted) {
          setInventory(devices)
          setInventoryError('')
        }
      }).catch(() => {
        if (!controller.signal.aborted) setInventoryError('No se pudo cargar el inventario de sensores.')
      })
    }
    return () => controller.abort()
  }, [mode, transport])

  async function scan() {
    const available = await sensorRequest<SerialPortOption[]>('/ports')
    setPorts(available)
    if (!available.some(port => port.path === selected)) setSelected('')
  }

  async function run(action: () => Promise<void>, success?: string) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
      if (success) setMessage(success)
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const changeMode = (next: Mode) => void run(() => sensorRequest('/mode', 'PUT', { mode: next }),
    next === 'arduino' ? 'Modo Arduino seleccionado.' : 'Modo simulación seleccionado.')
  const portLabel = serial?.state === 'open' ? (serial.confirmed ? 'Arduino identificado' : 'Puerto abierto · esperando el Arduino')
    : serial?.state === 'opening' ? 'Abriendo puerto…' : 'Puerto cerrado'

  return <div className="sensor-module">
    <header className="sensor-page-heading">
      <div><h1>Sensores</h1><p>Administra el DHT11 conectado por USB y la fuente de simulación ambiental.</p></div>
      <button className="irrigation-button" disabled={busy} onClick={() => void run(async () => {
        const devices = await sensorRequest<InventorySensor[]>('')
        setInventory(devices)
        setInventoryError('')
        await scan()
      }, 'Dispositivos y puertos actualizados.')}><RefreshCw size={16} />Actualizar dispositivos</button>
    </header>
    {offline && <p className="notice" role="status">{transport === 'loading' ? 'Consultando el servidor…' : 'Se perdió la conexión con el servidor.'}</p>}
    {error && <p className="irrigation-error" role="alert">{error}</p>}
    {message && <p className="irrigation-success" role="status">{message}</p>}
    <div className="sensor-controls">
      <section className="panel sensor-card">
        <div className="panel-heading"><span className="tile-icon purple"><FlaskConical size={20} /></span>
          <div><h2>Fuente de datos</h2><p>Selecciona el origen que usarán el resumen y el monitoreo.</p></div></div>
        <div className="source-options" role="group" aria-label="Modo de adquisición">
          <button aria-pressed={mode === 'simulation'} disabled={busy || offline} onClick={() => changeMode('simulation')}>
            <FlaskConical size={17} /><span><strong>Simulación</strong><small>Datos de prueba</small></span>
          </button>
          <button aria-pressed={mode === 'arduino'} disabled={busy || offline} onClick={() => changeMode('arduino')}>
            <Usb size={17} /><span><strong>Arduino</strong><small>Mediciones por USB</small></span>
          </button>
        </div>
      </section>
      <section className="panel sensor-card">
        <div className="panel-heading"><span className="tile-icon green"><Cable size={20} /></span>
          <div><h2>Conexión USB</h2><p>{mode === 'arduino' ? portLabel : 'Selecciona Arduino para conectar un puerto.'}</p></div></div>
        <div className="port-actions">
          <label>Puerto serie
            <select value={path} disabled={busy || serial?.state !== 'closed' || !ports?.length}
              onChange={event => setSelected(event.target.value)}>
              <option value="">Selecciona un puerto</option>
              {ports?.map(port => <option value={port.path} key={port.path}>{port.path}{port.arduinoCandidate ? ' · posible Arduino UNO' : port.manufacturer ? ` · ${port.manufacturer}` : ''}</option>)}
            </select>
          </label>
          <button className="irrigation-button" disabled={busy} onClick={() => void run(scan)}><Search size={16} />Buscar puertos</button>
        </div>
        {ports?.length === 0 && <p className="sensor-help">No se detectaron puertos serie. Conecta el Arduino con un cable USB de datos y vuelve a buscar.</p>}
        {Boolean(ports?.length) && !ports?.some(port => port.arduinoCandidate) && !serial?.confirmed &&
          <p className="sensor-help">No se identificó un Arduino UNO en la lista. Si tu placa usa otro adaptador USB, selecciona el COM verificado en Windows.</p>}
        {serial?.error && mode === 'arduino' && <p className="sensor-help sensor-warning" role="status">{serial.error}</p>}
        <div className="sensor-actions">
          {serial?.state === 'open' ? <button className="irrigation-button" disabled={busy || offline || mode !== 'arduino'}
            onClick={() => void run(() => sensorRequest('/disconnect', 'POST'), 'Puerto desconectado.')}>Desconectar Arduino</button> :
            <button className="irrigation-button primary" disabled={busy || offline || mode !== 'arduino' || serial?.state !== 'closed' || !path}
              onClick={() => void run(() => sensorRequest('/connect', 'POST', { path }))}>Conectar Arduino</button>}
        </div>
      </section>
    </div>
    <h2 className="sensor-section-heading">Sensores registrados</h2>
    {inventoryError && !inventory && <p className="irrigation-error" role="alert">{inventoryError}</p>}
    {!inventory && !inventoryError && <p className="sensor-help">Cargando dispositivos…</p>}
    <div className="sensor-controls">
      {inventory?.map(sensor => {
        const physical = sensor.id === 'arduino'
        const active = mode === sensor.id
        const reading = active ? snapshot?.latest : sensor.latest
        const status = offline ? 'Sin conexión con el servidor' : active && snapshot ? connectionLabels[snapshot.connection] : 'Inactivo'
        const stale = reading && (!active || offline || snapshot?.conditions.stale)
        const Icon = physical ? CircuitBoard : FlaskConical
        return <article className="panel sensor-card" key={sensor.id}>
          <div className="sensor-card-heading">
            <div className="panel-heading"><span className={`tile-icon ${physical ? 'green' : 'purple'}`}><Icon size={20} /></span>
              <div><h2>{sensor.name}</h2><p>{physical ? 'DHT11-01 · USB' : 'Mediciones simuladas'}</p></div></div>
            <span className={`status-pill ${active && !offline ? snapshot?.connection ?? '' : ''}`}><i />{status}</span>
          </div>
          <dl className="system-list sensor-details">
            <div><dt>Tipo</dt><dd>{sensor.type}</dd></div>
            <div><dt>Microcontrolador</dt><dd>{sensor.controller ?? '—'}</dd></div>
            {physical && <div><dt>Puerto serie</dt><dd>{serial?.path ?? 'Sin seleccionar'}</dd></div>}
            <div><dt>Última comunicación</dt><dd>{time(physical ? serial?.lastCommunication ?? reading?.time : reading?.time)}</dd></div>
            <div><dt>Última lectura</dt><dd>{time(reading?.time)}{stale && <small>Lectura histórica</small>}</dd></div>
            <div><dt>Humedad relativa</dt><dd>{reading ? `${formatNumber.format(reading.humidity)} % HR` : '—'}</dd></div>
            <div><dt>Temperatura ambiental</dt><dd>{reading ? `${formatNumber.format(reading.temperature)} °C` : '—'}</dd></div>
          </dl>
        </article>
      })}
    </div>
  </div>
}
