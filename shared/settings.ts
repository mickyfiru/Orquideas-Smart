export interface EnvironmentalLimits {
  humidityTarget: number
  humidityTolerance: number
  temperatureMin: number
  temperatureMax: number
}

export interface EnvironmentalSettings extends EnvironmentalLimits { staleSeconds: number }

export function humidityRange(settings: EnvironmentalLimits) {
  return {
    humidityMin: Math.max(0, settings.humidityTarget - settings.humidityTolerance),
    humidityMax: Math.min(100, settings.humidityTarget + settings.humidityTolerance),
  }
}

export function validateEnvironment(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'Completa la configuración ambiental.'
  const input = value as Partial<EnvironmentalSettings>
  const valid = (number: unknown, min: number, max: number): number is number =>
    typeof number === 'number' && Number.isFinite(number) && number >= min && number <= max
  if (!valid(input.humidityTarget, 0, 100) || !valid(input.humidityTolerance, 0, 100)) return 'La humedad objetivo y la tolerancia deben estar entre 0 y 100.'
  if (!valid(input.temperatureMin, -50, 100) || !valid(input.temperatureMax, -50, 100) || input.temperatureMin >= input.temperatureMax) {
    return 'La temperatura mínima debe ser menor que la máxima y ambas deben estar entre −50 y 100 °C.'
  }
  if (!valid(input.staleSeconds, 5, 3600) || !Number.isInteger(input.staleSeconds)) return 'El tiempo sin lecturas debe ser un entero entre 5 y 3600 segundos.'
  return null
}
