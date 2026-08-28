export interface WeatherApiInput {
  query: string;
}

export interface WeatherCurrentResult {
  providerId: "open-meteo";
  location: string;
  country?: string;
  latitude: number;
  longitude: number;
  timezone: string;
  observedAtLocal: string;
  retrievedAtUtc: string;
  temperatureC: number;
  apparentTemperatureC: number;
  relativeHumidityPercent: number;
  precipitationMm: number;
  weatherCode: number;
  windSpeedKmh: number;
  condition: string;
  sourceUrl: string;
  formatted: string;
}

export interface WeatherApiSuccess {
  ok: true;
  result: WeatherCurrentResult;
}
interface GeocodingResult {
  name?: unknown;
  country?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  timezone?: unknown;
}

interface GeocodingResponse {
  results?: GeocodingResult[];
}

interface ForecastResponse {
  timezone?: unknown;
  current?: {
    time?: unknown;
    temperature_2m?: unknown;
    apparent_temperature?: unknown;
    relative_humidity_2m?: unknown;
    precipitation?: unknown;
    weather_code?: unknown;
    wind_speed_10m?: unknown;
  };
}

function normalizeQuery(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}
export function extractWeatherLocation(query: string): string {
  const text = normalizeQuery(query);
  if (!text) throw new Error("WEATHER_INVALID_QUERY: празна заявка.");

  const patterns = [
    /(?:времето|прогноза(?:та)?\s+за\s+времето|температурата?)(?:\s+(?:в|за))\s+([^?!.,;]+)/iu,
    /(?:weather|forecast|temperature)(?:\s+(?:in|for))\s+([^?!.,;]+)/iu
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match?.[1]) continue;
    const location = match[1]
      .replace(/\b(?:днес|сега|в момента|today|now)\b/giu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    if (location.length >= 2 && location.length <= 120) return location;
  }

  throw new Error("WEATHER_LOCATION_NOT_FOUND: не открих населено място в заявката.");
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`WEATHER_INVALID_RESPONSE: липсва валидно ${field}.`);
  }
  return value;
}
function conditionForCode(code: number): string {
  if (code === 0) return "ясно";
  if ([1, 2].includes(code)) return "предимно ясно";
  if (code === 3) return "облачно";
  if ([45, 48].includes(code)) return "мъгла";
  if ([51, 53, 55, 56, 57].includes(code)) return "ръмеж";
  if ([61, 63, 65, 66, 67].includes(code)) return "дъжд";
  if ([71, 73, 75, 77].includes(code)) return "сняг";
  if ([80, 81, 82].includes(code)) return "дъждовни превалявания";
  if ([85, 86].includes(code)) return "снежни превалявания";
  if ([95, 96, 99].includes(code)) return "гръмотевична буря";
  return `метеорологичен код ${code}`;
}

async function fetchJson<T>(url: URL, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`WEATHER_PROVIDER_HTTP_${response.status}`);
    return await response.json() as T;
  } catch (error) {
    if (controller.signal.aborted) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      throw new Error(`WEATHER_PROVIDER_TIMEOUT: ${timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
export class OpenMeteoWeatherService {
  constructor(private readonly timeoutMs = 8_000) {}

  async handle(body: unknown, signal?: AbortSignal): Promise<WeatherApiSuccess> {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("WEATHER_INVALID_BODY: body трябва да е JSON object.");
    }
    const query = (body as { query?: unknown }).query;
    if (typeof query !== "string" || !query.trim()) {
      throw new Error("WEATHER_INVALID_QUERY: липсва query.");
    }

    const locationQuery = extractWeatherLocation(query);
    const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geocodeUrl.searchParams.set("name", locationQuery);
    geocodeUrl.searchParams.set("count", "1");
    geocodeUrl.searchParams.set("language", "bg");
    geocodeUrl.searchParams.set("format", "json");

    const geocode = await fetchJson<GeocodingResponse>(geocodeUrl, this.timeoutMs, signal);
    const place = geocode.results?.[0];
    if (!place || typeof place.name !== "string") {
      throw new Error(`WEATHER_LOCATION_NOT_FOUND: ${locationQuery}`);
    }
    const latitude = requiredNumber(place.latitude, "latitude");
    const longitude = requiredNumber(place.longitude, "longitude");
    const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
    forecastUrl.searchParams.set("latitude", String(latitude));
    forecastUrl.searchParams.set("longitude", String(longitude));
    forecastUrl.searchParams.set(
      "current",
      "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m"
    );
    forecastUrl.searchParams.set("timezone", "auto");
    forecastUrl.searchParams.set("forecast_days", "1");

    const forecast = await fetchJson<ForecastResponse>(forecastUrl, this.timeoutMs, signal);
    const current = forecast.current;
    if (!current || typeof current.time !== "string") {
      throw new Error("WEATHER_INVALID_RESPONSE: липсват current данни.");
    }

    const temperatureC = requiredNumber(current.temperature_2m, "temperature_2m");
    const apparentTemperatureC = requiredNumber(current.apparent_temperature, "apparent_temperature");
    const relativeHumidityPercent = requiredNumber(current.relative_humidity_2m, "relative_humidity_2m");
    const precipitationMm = requiredNumber(current.precipitation, "precipitation");
    const weatherCode = requiredNumber(current.weather_code, "weather_code");
    const windSpeedKmh = requiredNumber(current.wind_speed_10m, "wind_speed_10m");
    const country = typeof place.country === "string" ? place.country : undefined;
    const timezone = typeof forecast.timezone === "string"
      ? forecast.timezone
      : typeof place.timezone === "string" ? place.timezone : "unknown";
    const condition = conditionForCode(weatherCode);
    const locationLabel = country ? `${place.name}, ${country}` : place.name;
    const formatted = [
      `В ${locationLabel} в момента е ${temperatureC} °C (усеща се ${apparentTemperatureC} °C).`,
      `Условия: ${condition}; влажност ${relativeHumidityPercent}%; валеж ${precipitationMm} mm; вятър ${windSpeedKmh} km/h.`,
      `Данни към ${current.time} (${timezone}). Източник: Open-Meteo.`
    ].join(" ");

    return {
      ok: true,
      result: {
        providerId: "open-meteo",
        location: place.name,
        country,
        latitude,
        longitude,
        timezone,
        observedAtLocal: current.time,
        retrievedAtUtc: new Date().toISOString(),
        temperatureC,
        apparentTemperatureC,
        relativeHumidityPercent,
        precipitationMm,
        weatherCode,
        windSpeedKmh,
        condition,
        sourceUrl: forecastUrl.toString(),
        formatted
      }
    };
  }
}
