#include <DHT.h>
#include <math.h>

constexpr uint8_t DHT_PIN = 2;
constexpr unsigned long BAUD_RATE = 9600;
constexpr unsigned long SAMPLE_INTERVAL_MS = 5000;
static_assert(SAMPLE_INTERVAL_MS >= 2000, "Usa un intervalo de al menos dos segundos");

DHT dht(DHT_PIN, DHT11);
unsigned long lastSample = 0;

void setup() {
  Serial.begin(BAUD_RATE);
  dht.begin();
  lastSample = millis();
}

void loop() {
  const unsigned long now = millis();
  if (now - lastSample < SAMPLE_INTERVAL_MS) return;
  lastSample = now;

  const float humidity = dht.readHumidity();
  const float temperature = dht.readTemperature();
  if (!isfinite(humidity) || !isfinite(temperature) ||
      humidity < 0 || humidity > 100 || temperature < 0 || temperature > 50) {
    Serial.println(F("{\"sensorId\":\"DHT11-01\",\"status\":\"error\",\"code\":\"DHT_READ_FAILED\"}"));
    return;
  }

  Serial.print(F("{\"sensorId\":\"DHT11-01\",\"status\":\"ok\",\"humidity\":"));
  Serial.print(humidity, 1);
  Serial.print(F(",\"temperature\":"));
  Serial.print(temperature, 1);
  Serial.println(F("}"));
}
