from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
VENUES_JSON = ROOT / "venues.json"
FIXTURES_JSON = ROOT / "fixtures.json"
WEATHER_JSON = ROOT / "weather.json"

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
FORECAST_DAYS = 10
OPEN_METEO_TIMEOUT_SECONDS = 10
OPEN_METEO_MAX_ATTEMPTS = 2

def load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))

def get_venue_map():
    data = load_json(VENUES_JSON, {"venues": []})
    return {v["venue"]: v for v in data.get("venues", [])}

def is_in_forecast_window(kickoff_local: str, now: datetime, days: int = FORECAST_DAYS):
    kickoff = datetime.fromisoformat(kickoff_local)
    return now <= kickoff <= now + timedelta(days=days)

def fetch_open_meteo(lat: float, lon: float, timezone_name: str):
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m",
        "timezone": timezone_name,
        "forecast_days": FORECAST_DAYS,
    }
    last_error = None
    for _ in range(OPEN_METEO_MAX_ATTEMPTS):
        try:
            res = requests.get(OPEN_METEO_URL, params=params, timeout=OPEN_METEO_TIMEOUT_SECONDS)
            res.raise_for_status()
            return res.json(), None
        except requests.Timeout as exc:
            last_error = exc
        except requests.RequestException as exc:
            last_error = exc
    if isinstance(last_error, requests.Timeout):
        return None, ("api_timeout", str(last_error))
    return None, ("api_error", str(last_error))

def extract_hourly_window(forecast: dict, kickoff_local: str, game_minutes: int):
    hourly = forecast.get("hourly", {})
    times = hourly.get("time", [])
    if not times:
        return []

    kickoff = datetime.fromisoformat(kickoff_local)
    start = kickoff - timedelta(minutes=30)
    end = kickoff + timedelta(minutes=game_minutes)

    rows = []
    for idx, t in enumerate(times):
        dt = datetime.fromisoformat(t)
        if start <= dt <= end:
            rows.append({
                "time": t,
                "phase": phase_label(dt, kickoff, game_minutes),
                "temperature_2m": get_hourly(hourly, "temperature_2m", idx),
                "precipitation_probability": get_hourly(hourly, "precipitation_probability", idx),
                "precipitation_mm": get_hourly(hourly, "precipitation", idx),
                "wind_speed_10m": get_hourly(hourly, "wind_speed_10m", idx),
                "wind_gusts_10m": get_hourly(hourly, "wind_gusts_10m", idx),
            })
    return rows

def get_hourly(hourly: dict, key: str, idx: int):
    values = hourly.get(key, [])
    return values[idx] if idx < len(values) else None

def phase_label(dt: datetime, kickoff: datetime, game_minutes: int):
    mins = (dt - kickoff).total_seconds() / 60
    if mins < 0:
        return "pre_game"
    if mins <= 40:
        return "first_half"
    if mins <= 60:
        return "halftime_period"
    if mins <= 90:
        return "second_half"
    return "final_20_or_late"

def rate_hour(hour: dict):
    rain_mm = float(hour.get("precipitation_mm") or 0)
    rain_prob = float(hour.get("precipitation_probability") or 0)
    wind = float(hour.get("wind_speed_10m") or 0)
    gust = float(hour.get("wind_gusts_10m") or 0)
    temp = float(hour.get("temperature_2m") or 0)

    score = 0
    reasons = []

    if rain_prob >= 70 or rain_mm >= 2:
        score += 45
        reasons.append("high rain")
    elif rain_prob >= 40 or rain_mm >= 0.5:
        score += 25
        reasons.append("moderate rain")

    if wind >= 30 or gust >= 45:
        score += 30
        reasons.append("strong wind/gusts")
    elif wind >= 20 or gust >= 35:
        score += 15
        reasons.append("moderate wind/gusts")

    if temp <= 10:
        score += 10
        reasons.append("cold")
    elif temp >= 30:
        score += 10
        reasons.append("hot")

    return min(score, 100), reasons

def summarise_game_weather(hours: list[dict]):
    if not hours:
        return {
            "label": "Unknown",
            "score": 0,
            "reasons": ["No hourly forecast available"],
            "captainImpact": "Unknown weather risk."
        }

    scores = []
    all_reasons = []
    max_rain_prob = 0
    total_rain_mm = 0
    max_wind = 0
    max_gust = 0
    avg_temp_vals = []

    phase_scores = {}

    for h in hours:
        score, reasons = rate_hour(h)
        scores.append(score)
        all_reasons.extend(reasons)
        max_rain_prob = max(max_rain_prob, float(h.get("precipitation_probability") or 0))
        total_rain_mm += float(h.get("precipitation_mm") or 0)
        max_wind = max(max_wind, float(h.get("wind_speed_10m") or 0))
        max_gust = max(max_gust, float(h.get("wind_gusts_10m") or 0))
        if h.get("temperature_2m") is not None:
            avg_temp_vals.append(float(h.get("temperature_2m")))
        phase_scores.setdefault(h.get("phase", "unknown"), []).append(score)

    # Weighted risk: max matters because a late storm can wreck C/VC outcomes.
    avg_score = sum(scores) / len(scores)
    max_score = max(scores)
    final_score = round((avg_score * 0.6) + (max_score * 0.4))

    if final_score >= 60:
        label = "High"
    elif final_score >= 30:
        label = "Medium"
    else:
        label = "Low"

    phase_summary = {
        phase: {
            "avgScore": round(sum(vals) / len(vals)),
            "maxScore": max(vals)
        }
        for phase, vals in phase_scores.items()
    }

    return {
        "label": label,
        "score": final_score,
        "maxRainProbability": max_rain_prob,
        "totalGameRainMm": round(total_rain_mm, 2),
        "maxWindKmh": max_wind,
        "maxGustKmh": max_gust,
        "avgTemp": round(sum(avg_temp_vals) / len(avg_temp_vals), 1) if avg_temp_vals else None,
        "phaseRisk": phase_summary,
        "reasons": sorted(set(all_reasons)),
        "captainImpact": captain_impact(label, max_rain_prob, total_rain_mm, max_wind, max_gust),
    }

def captain_impact(label: str, rain_prob: float, rain_mm: float, wind: float, gust: float):
    if label == "High":
        return "High weather risk over game window. Downgrade CTW/FLB/attacking captains and goal kickers. Safer forwards/tacklers become better VC/C options."
    if label == "Medium":
        return "Moderate weather risk over game window. Be careful with backs as C/VC unless chasing POD upside."
    return "Low weather risk over game window. Normal captain logic applies."

def game_window(kickoff_local: str, game_minutes: int):
    kickoff = datetime.fromisoformat(kickoff_local)
    return {
        "from": (kickoff - timedelta(minutes=30)).isoformat(),
        "to": (kickoff + timedelta(minutes=game_minutes)).isoformat(),
        "gameMinutes": game_minutes
    }

def api_failure_result(fixture: dict, venue: dict, game_minutes: int, status: str, reason: str, error: Exception):
    return {
        **fixture,
        "city": venue.get("city"),
        "lat": venue["lat"],
        "lon": venue["lon"],
        "weatherStatus": status,
        "weatherError": str(error),
        "gameWindow": game_window(fixture["kickoffLocal"], game_minutes),
        "gameWindowWeather": [],
        "weatherRisk": {
            "score": 0,
            "label": "Unknown",
            "reasons": [reason],
            "captainImpact": "Unknown weather risk."
        },
    }

def main():
    venues = get_venue_map()
    fixtures_data = load_json(FIXTURES_JSON, {"fixtures": []})
    results = []
    forecast_cache = {}
    now = datetime.now()

    for fixture in fixtures_data.get("fixtures", []):
        if not is_in_forecast_window(fixture["kickoffLocal"], now):
            continue

        venue_name = fixture.get("venue")
        venue = venues.get(venue_name)
        game_minutes = int(fixture.get("gameMinutes") or 110)

        if not venue:
            results.append({
                **fixture,
                "weatherStatus": "missing_venue",
                "gameWindowWeather": [],
                "weatherRisk": {"score": 0, "label": "Unknown", "reasons": ["Venue missing from venues.json"]},
            })
            continue

        tz = fixture.get("timezone") or "Australia/Brisbane"
        cache_key = (venue["lat"], venue["lon"], tz)
        if cache_key not in forecast_cache:
            forecast_cache[cache_key] = fetch_open_meteo(venue["lat"], venue["lon"], tz)
        forecast, forecast_error = forecast_cache[cache_key]
        if forecast_error:
            status, error_message = forecast_error
            results.append({
                **fixture,
                "city": venue.get("city"),
                "lat": venue["lat"],
                "lon": venue["lon"],
                "weatherStatus": status,
                "weatherError": error_message,
                "gameWindow": {
                    "from": (datetime.fromisoformat(fixture["kickoffLocal"]) - timedelta(minutes=30)).isoformat(),
                    "to": (datetime.fromisoformat(fixture["kickoffLocal"]) + timedelta(minutes=game_minutes)).isoformat(),
                    "gameMinutes": game_minutes
                },
                "gameWindowWeather": [],
                "weatherRisk": {
                    "score": 0,
                    "label": "Unknown",
                    "reasons": [error_message],
                    "captainImpact": "Unknown weather risk.",
                },
            })
            continue

        hours = extract_hourly_window(forecast, fixture["kickoffLocal"], game_minutes)
        summary = summarise_game_weather(hours)

        results.append({
            **fixture,
            "city": venue.get("city"),
            "lat": venue["lat"],
            "lon": venue["lon"],
            "weatherStatus": "updated",
            "gameWindow": game_window(fixture["kickoffLocal"], game_minutes),
            "gameWindowWeather": hours,
            "weatherRisk": summary,
        })

    output = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "source": "Open-Meteo hourly forecast API",
        "note": "Weather covers pre-game through full game window. Forecast updates when workflow runs.",
        "matches": results,
    }
    WEATHER_JSON.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(f"Updated weather.json with {len(results)} matches using game-window weather")

if __name__ == "__main__":
    main()
