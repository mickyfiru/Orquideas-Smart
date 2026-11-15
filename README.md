# Orquídeas Smart

Panel de monitoreo de un invernadero de orquídeas para Integración de Competencias II de Santo Tomás. Incluye el dashboard, calendario de riego, adquisición USB, monitoreo, historial ambiental y configuración de alertas.

## Inicio local

Requiere Node.js 24 o posterior y npm. La entrega se verificó en Windows con Node.js 26.13.0 y npm 11.20.0.

```powershell
npm ci
npm run dev
```

Abre [el panel](http://localhost:5173). Vite redirige las solicitudes REST y WebSocket al backend local en el puerto 3001. Para iniciar los servicios por separado, ejecuta `npm run dev:api` y `npm run dev:web` en dos terminales.

Para ejecutar la compilación local con Express, usa `npm run build`, luego `npm start` y abre [el servidor](http://127.0.0.1:3001).

## Datos y funcionamiento

- El backend simula una lectura cada cinco segundos. El panel marca su origen e informa cero sensores físicos conectados. El DHT11 con Arduino UNO R3 queda registrado como dispositivo configurado.
- El gráfico en tiempo real usa una ventana móvil de quince minutos y recibe nuevas lecturas por WebSocket. Los rangos de 24 horas, siete días y treinta días consultan SQLite por REST. La primera ejecución de simulación aporta 720 lecturas horarias identificadas como simuladas.
- SQLite se crea automáticamente en `data/orquideas.sqlite`. La migración 1 usa `PRAGMA user_version` y crea `sensors`, `environmental_readings` y `system_settings`. La clave compuesta de lecturas permite consultar por sensor y fecha y evita duplicados. Hay una clave foránea hacia el sensor y restricciones de rango.
- El archivo SQLite conserva el histórico y la configuración. La frecuencia inicial de registro es de 60 minutos por fuente. La humedad objetivo es 80 % con una tolerancia inicial de ±5 puntos porcentuales y la temperatura objetivo es de 18 a 24 °C. El panel usa la zona horaria `America/Santiago`.
- La variable `ORQ_DB` admite una ruta alternativa para SQLite. `ORQ_MODE` puede fijar el modo inicial de un proceso a `arduino` o `simulation`. Si está ausente se usa el modo guardado al elegirlo en la interfaz.

## Sensores y monitoreo

- En [Sensores](http://localhost:5173/sensores), elige **Simulación** para probar sin hardware o **Arduino** para usar el DHT11 por USB. En el segundo modo, busca los puertos, selecciona el COM de la placa y elige **Conectar Arduino**. El inventario identifica la comunicación real después de recibir una trama reconocida del sketch.
- En [Monitoreo ambiental](http://localhost:5173/monitoreo), consulta las mediciones recibidas por WebSocket, selecciona un rango del gráfico y ajusta la tolerancia de humedad. El objetivo inicial es 80 % HR con ±5 puntos porcentuales y el rango de temperatura es de 18 a 24 °C. Las advertencias reflejan el estado actual. Una lectura anterior se muestra como desactualizada al perder la conexión, al recibir una trama defectuosa o al superar el tiempo configurado sin lecturas válidas (20 segundos por defecto).
- La migración 3 agrega `acquisition_settings` y `latest_sensor_readings`. Se conserva la última lectura física tras reiniciar, con independencia de la cadencia histórica. La selección del modo y el último puerto abierto sobreviven al reinicio. Usa **Conectar Arduino** para volver a abrir el puerto. Las fuentes se mantienen separadas aun cuando se cambie de modo.
- [Guía de Arduino y DHT11](arduino/README.md) con materiales, pines, bibliotecas y diagnóstico. El sketch se compiló con Arduino CLI 1.6.0 para `arduino:avr:uno`, usando Arduino AVR Boards 1.8.8, DHT sensor library 1.4.7 y Adafruit Unified Sensor 1.1.15. Falta cargarlo y verificarlo con una placa física.

## Probar el calendario y los recordatorios

1. Abre [Calendario de riego](http://localhost:5173/calendario) y elige **Nuevo riego**. Para recibir enseguida un recordatorio, crea un riego único activo para unos minutos más adelante, en hora de Santiago.
2. Revisa el día marcado, la lista de próximos riegos y la tarjeta **Próximo riego** del resumen. Usa **Programaciones** para cambiar la hora, pausar, reactivar o eliminar con confirmación.
3. Abre la campana. Usa **Activar avisos del navegador** si tu navegador lo ofrece y mantén la aplicación abierta. Al vencer la hora, aparece un aviso interno y el recordatorio queda disponible en la campana para marcarlo como leído.
4. Usa el botón con un visto en la agenda del día o en próximos riegos para registrar el riego manual, incluso si lo adelantaste. Comprueba **Riegos realizados** y verifica que el registro se conserve si editas o eliminas la programación.

La migración 2 añade `irrigation_schedules` e `irrigation_events`. Guarda las fechas de creación, modificación y eliminación de las programaciones y el estado de cada ocurrencia. El servicio comprueba vencimientos cada segundo y, al reiniciar, retoma el próximo vencimiento de cada programación activa. La clave única por programación y hora evita avisos repetidos. Las modificaciones se publican por el WebSocket de telemetría.

La fecha inicial determina desde cuándo se repite la programación. Las recurrencias semanales usan el día de la fecha inicial y las personalizadas usan los días seleccionados. Las horas se interpretan en `America/Santiago`. Si el cambio de hora omite una hora, el riego se desplaza por la duración del salto. Si una hora se repite, se usa su primera aparición.

Los avisos internos se conservan en SQLite. Las notificaciones del navegador requieren un contexto seguro, un navegador compatible y permiso. Se solicitan desde la aplicación abierta. El envío push con la página cerrada queda fuera de esta fase. [API de notificaciones](https://developer.mozilla.org/es/docs/Web/API/Notifications_API)

## Probar el historial ambiental

1. Abre [Historial ambiental](http://localhost:5173/historial) o selecciona **Ver historial completo** en el gráfico del resumen. El acceso del resumen conserva el origen y el rango actual. Desde tiempo real abre las últimas 24 horas.
2. Selecciona un período y prueba los filtros de sensor, origen y condición. El intervalo personalizado incluye ambas fechas según `America/Santiago`, incluidos los días con cambio de hora. Haz clic en las columnas Fecha y hora, Temperatura o Humedad relativa para ordenar y usa las flechas del pie para cambiar de página.
3. Consulta los valores de los puntos en los gráficos y descarga **Exportar CSV**. El gráfico muestra hasta 360 lecturas almacenadas por origen. El CSV y las estadísticas usan todas las filas filtradas. Las fechas del CSV incluyen el desfase horario de Santiago.
4. Abre **Frecuencia de almacenamiento**, elige 1, 5, 15, 30 o 60 minutos y guarda. El intervalo se mide desde la última fila archivada por sensor. El gráfico en tiempo real mantiene su cadencia de recepción. Pulsa **Actualizar** para volver a consultar el historial.

La migración 4 agrega el índice `environmental_readings_by_time` sobre fecha y sensor. La validez indica que la lectura fue aceptada para almacenamiento. El estado ambiental y el porcentaje dentro de rango se recalculan con los límites vigentes para el conjunto filtrado.

| Método y ruta | Función |
| --- | --- |
| `GET /api/history/readings` | Filtra, ordena y pagina las mediciones. |
| `GET /api/history/summary` | Calcula estadísticas y series históricas por origen. |
| `GET /api/history/storage` | Consulta la frecuencia de registro. |
| `PUT /api/history/storage` | Guarda la frecuencia con el campo `storageMinutes`. |
| `GET /api/history/export.csv` | Descarga el conjunto filtrado completo. |
| `GET /api/sensors` | Reutiliza el inventario de sensores. |

Los filtros comunes son `period` (`day`, `week`, `month` o `custom`), `from` y `to` para el período personalizado, `sensor`, `origin` y `condition`. La tabla admite `sort`, `direction`, `page` y `pageSize`. El CSV acepta el mismo orden y exporta todas las páginas.

## Probar las alertas y la configuración

1. Usa **Simulación** en [Sensores](http://localhost:5173/sensores). En [Configuración](http://localhost:5173/configuracion), anota tus valores actuales y guarda una humedad objetivo de 100 % HR con tolerancia de 0. El simulador generará una alerta de humedad baja.
2. Abre la campana o [Alertas](http://localhost:5173/alertas) y marca el evento como leído. Comprueba que sigue activo. Restablece los valores anteriores y confirma que el historial conserva el valor medido y el límite registrados. Si las condiciones vuelven al rango sin cambiar la configuración, el motor requiere dos mediciones válidas de recuperación.
3. Deshabilita los avisos internos en Configuración y guarda. Los nuevos eventos seguirán registrándose en Alertas. Si habilitas los avisos del navegador, se requiere permiso y una pestaña abierta. Los recordatorios de riego tienen su propia preferencia.
4. En el historial de mediciones, usa **Alertas del período**. La clasificación de las mediciones usa los límites actuales. Cada evento de alerta conserva el límite al detectarse.

La migración 5 amplía `system_settings` y crea la tabla `alerts` con índices para consultas temporales, eventos sin leer y una restricción única por condición activa y sensor. Cambiar de origen cierra las condiciones activas del origen anterior. La alerta de desconexión de Arduino se registra cuando se pierde un enlace que llegó a estar abierto. Un puerto abierto sin datos iniciales puede generar falta de respuesta al superar el plazo, y un puerto con datos anteriores puede generar una alerta de antigüedad.

| Método y ruta | Función |
| --- | --- |
| `GET /api/alerts` | Consulta paginada por período, tipo, sensor, severidad, resolución y lectura. |
| `PATCH /api/alerts/:id/read` | Confirma la lectura de un evento. |
| `GET /api/notifications` | Combina eventos ambientales, comunicación y recordatorios para la campana. |
| `GET /api/settings` | Consulta parámetros, versión, preferencias y zona horaria. |
| `PUT /api/settings/environment` | Actualiza los límites y el tiempo máximo sin lecturas. |
| `PUT /api/settings/notifications` | Actualiza preferencias de avisos. |

Configuración reutiliza los endpoints de frecuencia histórica y el panel de Sensores para abrir y cerrar puertos serie.

## Carpetas y dependencias

```text
frontend/             React, navegación, estilos y recursos
  assets/             Fotografía de la cabecera
  dashboard/          Indicadores, gráficos y cliente de telemetría
  irrigation/        Calendario, formulario y campana de recordatorios
  sensors/           Inventario, controles USB y monitoreo ambiental
  history/           Filtros, estadísticas, gráficos y tabla del historial
  system/            Configuración, alertas y campana
backend/              Express, WebSocket, adquisición, SQLite y pruebas
  irrigation/        Migración, API y operaciones de riego
  sensors/           Protocolo JSON, SerialPort, API y migración
  history/           Validación, consultas históricas y exportación CSV
  alerts/            Motor, migración, consultas y bandeja de notificaciones
  settings/          API de parámetros y preferencias
arduino/              Sketch para Arduino UNO y guía de conexión
shared/               Tipos, validación y cálculo de recurrencias
public/               Servicio de avisos para navegadores compatibles
data/                 Base de datos local, generada al iniciar
```

Las versiones verificadas están fijadas en `package-lock.json`. React 19.3.1, React Router 7.18.5, TypeScript 7.0.2, Vite 8.3.8, Tailwind CSS 4.3.5, Recharts 3.10.1, Lucide React 1.73.0, Express 5.3.0, ws 8.23.0, Temporal Polyfill 0.5.1 y SerialPort 13.0.0. SQLite se carga con `node:sqlite`.

## Verificación y módulos pendientes

Ejecuta `npm test` para correr las pruebas de telemetría, riego, sensores, historial y alertas. Las pruebas usan un puerto emulado y bases aisladas. Las verificaciones de alertas cubren límites, pérdida de conexión, errores serie, estabilización, persistencia, WebSocket y la campana. `npm run build` verifica tipos y compila el frontend.

El riego es manual. Sigue pendiente la validación con un Arduino y un DHT11 físicos.

La imagen de referencia mencionada en el encargo no venía adjunta. El diseño se basó en la descripción escrita. La fotografía de cabecera se generó con ImageGen a partir de una toma panorámica de orquídeas Phalaenopsis moradas a la derecha, en un invernadero verde esmeralda oscuro con espacio a la izquierda para el texto.
