# Arduino UNO R3 y DHT11

Antes de conectar, **verifica las etiquetas VCC, DATA y GND de tu módulo DHT11 o consulta su ficha**. El orden puede variar según el fabricante. Desenchufa el cable USB mientras cableas.

## Materiales y pines

- Arduino UNO R3, un DHT11, cables de conexión y un cable USB de datos compatible con la placa.
- En un DHT11 sin placa de módulo, usa una resistencia pull-up de 4,7–10 kΩ entre DATA y VCC. Algunos módulos ya llevan la resistencia. Consulta la ficha de tu unidad.
- Para el DHT11 compatible con 5 V, conecta VCC a **5V**, DATA a **D2** y GND a **GND** del Arduino. En el sensor de cuatro patas, deja NC sin conexión según la ficha. [Ficha del DHT11](https://www.mouser.com/datasheet/2/758/DHT11-Technical-Data-Sheet-Translated-Version-1143054.pdf)

## Cargar el programa

1. Abre `OrquideasSmart/OrquideasSmart.ino` en Arduino IDE. Instala **Arduino AVR Boards**, **DHT sensor library** de Adafruit y su dependencia **Adafruit Unified Sensor** desde los gestores del IDE.
2. Conecta el UNO por USB. Selecciona **Arduino Uno** en el menú de placas y el puerto detectado. En Windows puedes comparar **Administrador de dispositivos → Puertos (COM y LPT)** antes y después de conectar la placa. El número COM puede cambiar.
3. Carga el sketch. Abre el Monitor Serie a **9600 baudios**. Aproximadamente cada cinco segundos debe aparecer una línea con la humedad relativa y la temperatura medidas, o un mensaje `DHT_READ_FAILED` si falla la lectura. El sketch usa la constante `SAMPLE_INTERVAL_MS` para ajustar el intervalo. Mantén al menos 2000 ms y, para que la aplicación considere reciente la lectura, utiliza un intervalo menor de 20 segundos. [Biblioteca DHT de Adafruit](https://github.com/adafruit/DHT-sensor-library)
4. Cierra el Monitor Serie. Inicia la aplicación con `npm run dev`. En **Sensores**, elige **Arduino**, pulsa **Buscar puertos**, selecciona el COM identificado y pulsa **Conectar Arduino**. Espera la primera trama para que la aplicación identifique el dispositivo. Abre **Monitoreo ambiental** para ver las lecturas.
5. Desconecta físicamente el USB para comprobar el estado desconectado y la etiqueta de lectura histórica. Reconecta el cable, vuelve a buscar puertos si cambió el COM y usa **Conectar Arduino**.

## Diagnóstico

| Síntoma | Qué revisar |
| --- | --- |
| El COM no aparece | Prueba otro puerto o cable USB de datos. Consulta el Administrador de dispositivos y, si la placa usa un conversor diferente, verifica su controlador. |
| El COM está ocupado | Cierra el Monitor Serie, el trazador del IDE y cualquier otra aplicación que use el puerto. |
| Puerto abierto, Arduino sin identificar | Confirma el COM, la carga del sketch y los 9600 baudios. Tras abrir el puerto, el UNO puede reiniciarse. Espera el primer ciclo. |
| `DHT_READ_FAILED` | Verifica la alimentación, tierra común, DATA en D2, el tipo DHT11 en el sketch y la resistencia pull-up. |
| Datos desactualizados | Revisa el cable, el sketch y el intervalo. El servidor conserva la última lectura física y el modo seleccionado. |
| Tras reiniciar la aplicación | El modo y el último COM quedan guardados. Usa **Conectar Arduino** para abrir el puerto nuevamente. |

El Arduino envía JSON por línea y el servidor agrega la marca de tiempo de recepción. El UNO R3 de esta fase se comunica por USB. Una futura conexión Wi-Fi requiere hardware y un adaptador de adquisición adicionales. [Ficha oficial del Arduino UNO R3](https://docs.arduino.cc/hardware/uno-rev3/)
