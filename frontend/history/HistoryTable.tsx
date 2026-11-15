import { ArrowDown, ArrowDownUp, ArrowUp, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { originLabels, sensorIdentifiers } from '../../shared/history.ts'
import type { HistoryDirection, HistoryPage, HistorySort } from '../../shared/history.ts'
import { formatReadingTime } from '../dashboard/ClimateChart.tsx'
import { formatNumber } from '../sensors/status.ts'

export function HistoryTable({ data, error, sort, direction, setSort, setPage, exportUrl }: {
  data?: HistoryPage; error?: string; sort: HistorySort; direction: HistoryDirection;
  setSort: (column: HistorySort) => void; setPage: (page: number) => void; exportUrl: string
}) {
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const column = (name: string, field: HistorySort) => {
    const Icon = sort !== field ? ArrowDownUp : direction === 'asc' ? ArrowUp : ArrowDown
    return <th scope="col" aria-sort={sort === field ? (direction === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button onClick={() => setSort(field)}>{name}<Icon size={14} aria-hidden="true" /></button>
    </th>
  }

  return <section className="panel history-table-card" aria-label="Registros ambientales">
    <div className="history-section-heading">
      <div><h2>Registros ambientales</h2><p>{data ? `${formatNumber.format(data.total)} ${data.total === 1 ? 'medición' : 'mediciones'} con los filtros aplicados` : 'Lecturas guardadas en SQLite'}</p></div>
      {Boolean(data?.total) && <a className="irrigation-button" href={exportUrl} download="historial-ambiental.csv"><Download size={16} />Exportar CSV</a>}
    </div>
    {error ? <p className="irrigation-error" role="alert">{error}</p> : !data ? <p className="history-empty">Cargando registros…</p> :
      data.total === 0 ? <p className="history-empty">Sin mediciones para el período y los filtros seleccionados.</p> :
      <>
        <div className="history-table-scroll" tabIndex={0} role="region" aria-label="Tabla de mediciones, desplazable horizontalmente">
          <table>
            <thead><tr>
              {column('Fecha y hora', 'time')}<th scope="col">Sensor</th>{column('Temperatura', 'temperature')}{column('Humedad relativa', 'humidity')}
              <th scope="col">Origen</th><th scope="col">Estado ambiental</th><th scope="col">Validez</th>
            </tr></thead>
            <tbody>{data.rows.map(row => <tr key={row.sensorId + '-' + row.time}>
              <td><time dateTime={new Date(row.time).toISOString()}>{formatReadingTime(row.time)}</time></td>
              <td>{sensorIdentifiers[row.sensorId]}</td>
              <td>{formatNumber.format(row.temperature)} °C</td><td>{formatNumber.format(row.humidity)} % HR</td>
              <td><span className={`status-pill ${row.origin === 'simulation' ? 'simulation' : 'connected'}`}>{originLabels[row.origin]}</span></td>
              <td><span className={`status-pill ${row.condition === 'normal' ? 'connected' : 'stale'}`}><i />{row.condition === 'normal' ? 'En rango' : 'Fuera de rango'}</span></td>
              <td>{row.valid ? 'Válida' : 'Inválida'}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="history-pager">
          <span aria-live="polite">Página {data.page} de {lastPage}</span>
          {data.rows.length === 0 && <button className="irrigation-button" onClick={() => setPage(lastPage)}>Ir a la última página</button>}
          <div>
            <button className="icon-button" aria-label="Página anterior" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}><ChevronLeft size={17} /></button>
            <button className="icon-button" aria-label="Página siguiente" disabled={data.page >= lastPage} onClick={() => setPage(data.page + 1)}><ChevronRight size={17} /></button>
          </div>
        </div>
      </>}
  </section>
}
