from dotenv import load_dotenv
import os
import time
import requests
import json
from typing import Any, Dict, List, Optional, Union

load_dotenv()

# ---------- CONFIG (env-based) ----------
API_KEY = os.getenv("TIMETABLE_API_KEY")
BASE_URL = os.getenv("BASE_URL", "https://www.timetablemaster.com/api")
TIMETABLE_ID = os.getenv("TIMETABLE_ID") or None
CACHE_TTL = int(os.getenv("CACHE_TTL", "25"))
# ----------------------------------------

_cache: Dict[str, Any] = {"ts": 0.0, "data": None}


def _log(msg: str, *args):
    """Simple console logger used for debugging during development."""
    try:
        if args:
            print("[timetable_service]", msg % args)
        else:
            print("[timetable_service]", msg)
    except Exception:
        # fallback
        print("[timetable_service]", msg, *args)


def _build_headers() -> Dict[str, str]:
    """Return request headers, only include Authorization if API_KEY is present."""
    headers = {"Content-Type": "application/json"}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
    return headers


def _safe_json(resp: requests.Response) -> Any:
    """Return resp.json() but never raise to caller (returns dict/list or {})."""
    try:
        return resp.json()
    except Exception as e:
        _log("Failed to parse JSON response: %s", str(e))
        # try a more permissive load from text
        try:
            return json.loads(resp.text)
        except Exception:
            return {}


def _extract_data_from_response(obj: Any) -> Optional[Any]:
    """
    Try to extract the useful payload from several common response shapes:
      - direct timetable (contains keys like '_id', 'schedule', 'classes', ...)
      - { "success": True, "data": { ... } }
      - { "data": [ ... ] } or { "timetables": [ ... ] }
      - pass through lists/dicts otherwise
    """
    if obj is None:
        return None

    # if it's already the direct timetable (has expected keys)
    if isinstance(obj, dict):
        timetable_keys = {
            "_id",
            "generalSettings",
            "schedule",
            "subjects",
            "classes",
            "teachers",
        }
        if any(k in obj for k in timetable_keys):
            return obj

        # prefer obj['data'] if present
        data = obj.get("data")
        if data:
            # if data itself looks like timetable, return it; otherwise return data
            if isinstance(data, dict) and any(k in data for k in timetable_keys):
                return data
            return data

        if "timetables" in obj and obj["timetables"]:
            return obj["timetables"]

    # if obj is list, return it (caller can decide)
    return obj


def _normalize_listing_to_list(listing: Any) -> List[Dict]:
    """
    Given a listing response, return a list of timetable-like dicts.
    Handles shapes: dict with data->{timetables: [...]}, dict with 'timetables',
    dict with 'data' being a list, or a direct list.
    """
    if not listing:
        return []

    if isinstance(listing, list):
        return listing

    if isinstance(listing, dict):
        # data might be dict containing 'timetables' or might be a list itself
        data = listing.get("data")
        if isinstance(data, dict) and "timetables" in data:
            return data.get("timetables") or []
        if isinstance(data, list):
            return data
        if "timetables" in listing and isinstance(listing["timetables"], list):
            return listing["timetables"]
        # fallback: if listing looks like {id:..., name:...} treat as single item
        # but wrap into a list
        # Check for keys that indicate a single timetable
        for k in ("id", "_id", "name", "title", "timetableName"):
            if k in listing:
                return [listing]
    return []


def fetch_timetable_data(force_refresh: bool = False) -> Optional[Dict]:
    """
    Fetch timetable JSON from TimetableMaster live API.
    Uses a simple in-memory cache controlled by CACHE_TTL.
    Returns the parsed timetable dict (or None on failure).
    """
    now = time.time()
    if not force_refresh and _cache["data"] and (now - float(_cache["ts"]) < CACHE_TTL):
        _log("Using cached timetable (age %.1fs)", now - float(_cache["ts"]))
        return _cache["data"]

    if not API_KEY:
        _log("ERROR: TIMETABLE_API_KEY environment variable is not set.")
        return None

    if not BASE_URL:
        _log("ERROR: BASE_URL is empty.")
        return None

    resp: Optional[requests.Response] = None
    headers = _build_headers()
    try:
        # If a specific timetable id is configured, fetch that directly.
        if TIMETABLE_ID:
            url = f"{BASE_URL.rstrip('/')}/timetables/{TIMETABLE_ID}"
            _log("Fetching specific timetable: %s", url)
            resp = requests.get(url, headers=headers, timeout=20)
            _log("Response status: %s", resp.status_code)
            resp.raise_for_status()
            result = _safe_json(resp)
            data = _extract_data_from_response(result)

        else:
            # Call the list endpoint to find a timetable (pick first published)
            list_url = f"{BASE_URL.rstrip('/')}/timetables"
            _log("Listing timetables: %s", list_url)
            resp = requests.get(list_url, headers=headers, timeout=20)
            _log("List response status: %s", getattr(resp, "status_code", "N/A"))
            if resp is not None and resp.status_code != 200:
                _log("List response body (truncated): %s", resp.text[:2000])
            resp.raise_for_status()
            listing = _safe_json(resp)

            timetables = _normalize_listing_to_list(listing)
            if not timetables:
                _log(
                    "No timetables found in listing response. Full listing (truncated): %s",
                    str(listing)[:2000],
                )
                raise RuntimeError("No timetables found in your account.")

            # pick first published otherwise first entry
            chosen = next((t for t in timetables if t.get("status") == "published"), timetables[0])
            chosen_id = (
                chosen.get("id")
                or chosen.get("_id")
                or chosen.get("tid")
                or chosen.get("timetableId")
            )
            if not chosen_id:
                _log(
                    "Could not determine chosen timetable id from listing item: %s",
                    str(chosen)[:300],
                )
                raise RuntimeError("Could not determine timetable id from listing.")

            url = f"{BASE_URL.rstrip('/')}/timetables/{chosen_id}"
            _log("Fetching chosen timetable: %s", url)
            resp = requests.get(url, headers=headers, timeout=20)
            _log("Fetch chosen status: %s", resp.status_code)
            resp.raise_for_status()
            result = _safe_json(resp)
            data = _extract_data_from_response(result)

        if not data:
            _log(
                "ERROR: No timetable data returned. Latest response snippet (truncated): %s",
                json.dumps(result if isinstance(result, dict) else {}, indent=2)[:4000],
            )
            raise RuntimeError("No timetable data returned from API.")

        # cache and return
        _cache["ts"] = now
        _cache["data"] = data
        _log("Timetable fetched and cached.")
        return data

    except requests.exceptions.RequestException as re:
        _log("Network/HTTP error when calling API: %s", str(re))
        if resp is not None:
            try:
                _log("Last response text (truncated): %s", resp.text[:2000])
            except Exception:
                pass
        return None
    except Exception as e:
        _log("Unexpected error: %s", str(e))
        return None


def list_available_timetables() -> List[Dict]:
    """
    Convenience helper to call /timetables and return a normalized list of timetable metadata.
    Useful for showing the catalog page.
    """
    if not API_KEY:
        _log("ERROR: TIMETABLE_API_KEY not set; cannot list timetables.")
        return []

    headers = _build_headers()
    resp: Optional[requests.Response] = None
    try:
        list_url = f"{BASE_URL.rstrip('/')}/timetables"
        _log("Listing timetables (catalog): %s", list_url)
        resp = requests.get(list_url, headers=headers, timeout=20)
        _log("Catalog response status: %s", getattr(resp, "status_code", "N/A"))
        resp.raise_for_status()
        listing = _safe_json(resp)

        raw_list = _normalize_listing_to_list(listing)
        if not raw_list:
            _log("No timetables found in catalog listing.")
            return []

        normalized = []
        for t in raw_list:
            normalized.append(
                {
                    "id": t.get("id") or t.get("_id"),
                    "name": t.get("name") or t.get("timetableName") or t.get("title"),
                    "status": t.get("status"),
                    "published_at": (
                        t.get("publishedAt")
                        or t.get("published_at")
                        or t.get("createdAt")
                        or t.get("created_at")
                    ),
                    "description": t.get("description") or t.get("notes") or "",
                }
            )
        return normalized
    except requests.exceptions.RequestException as re:
        _log("Network error while listing timetables: %s", str(re))
        if resp is not None:
            try:
                _log("Last response text (truncated): %s", resp.text[:2000])
            except Exception:
                pass
        return []
    except Exception as e:
        _log("Error while listing timetables: %s", str(e))
        return []


def build_maps_and_grids(raw: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert raw timetable payload into a structure the frontend expects:
      - days: list[str]
      - periods: list[ { index, start_time, end_time, name } ]
      - classes_grid: { className: matrix[day][period] -> list of slots }
      - teachers_grid: { teacherName: matrix[day][period] -> list of slots }
      - subjects_map: { id: subjectObj }
      - raw_meta: { name, id }
    """
    if not raw or not isinstance(raw, dict):
        return {}

    general = raw.get("generalSettings", {}) or {}
    days = (
        general.get("dayNames")
        or general.get("days")
        or ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    )

    periods_raw = general.get("periods") or []
    # try multiple keys for periods per day; ensure int and fallback to len(periods_raw) or 0
    periods_per_day_raw = general.get("periodsPerDay") or general.get("periods_per_day") or None
    try:
        periods_per_day = int(periods_per_day_raw) if periods_per_day_raw is not None else len(periods_raw)
    except Exception:
        periods_per_day = len(periods_raw)

    if periods_per_day <= 0:
        periods_per_day = len(periods_raw)

    # build periods list
    periods: List[Dict[str, Any]] = []
    for i in range(periods_per_day):
        p = periods_raw[i] if i < len(periods_raw) else {}
        periods.append(
            {
                "index": i,
                "start_time": p.get("start_time") or p.get("startTime") or p.get("start") or "",
                "end_time": p.get("end_time") or p.get("endTime") or p.get("end") or "",
                "name": p.get("name") or p.get("label") or f"Period {i+1}",
            }
        )

    # helper maps (id -> obj)
    def map_by_id(items: Union[List[Dict], None]) -> Dict[str, Dict]:
        out = {}
        if not items:
            return out
        for it in items:
            # prefer id or _id; cast to str to avoid None keys
            key = it.get("id") or it.get("_id")
            if key is None:
                # if no id, try name/title as fallback (not ideal but prevents data loss)
                key = it.get("name") or it.get("title")
            if key is not None:
                out[str(key)] = it
        return out

    classes_map = map_by_id(raw.get("classes") or [])
    teachers_map = map_by_id(raw.get("teachers") or [])
    subjects_map = map_by_id(raw.get("subjects") or raw.get("lessons") or [])

    def empty_matrix():
        return [[[] for _ in range(periods_per_day)] for _ in range(len(days))]

    classes_grid: Dict[str, List[List[List[Dict]]]] = {}
    teachers_grid: Dict[str, List[List[List[Dict]]]] = {}

    schedule_entries = raw.get("schedule") or []
    for entry in schedule_entries:
        # normalize day name
        day_name = (
            entry.get("day")
            or entry.get("dayName")
            or entry.get("day_name")
            or (days[0] if days else "Monday")
        )
        # find day index
        try:
            day_index = days.index(day_name)
        except ValueError:
            # fallback: match by first 3 letters case-insensitive
            day_index = next(
                (i for i, d in enumerate(days) if str(d).lower().startswith(str(day_name).lower()[:3])),
                0,
            )

        # period index field variations
        period_index = entry.get("period_index")
        if period_index is None:
            period_index = entry.get("period") or entry.get("periodIndex") or entry.get("index") or 0
        try:
            period_index = int(period_index)
        except Exception:
            period_index = 0

        # subject lookup (support subjectIds list or subjectId single)
        subject_name, subject_color = "-", None
        sid = None
        if entry.get("subjectIds"):
            try:
                sid = entry["subjectIds"][0]
            except Exception:
                sid = None
        elif entry.get("subjectId"):
            sid = entry.get("subjectId")
        if sid is not None:
            s = subjects_map.get(str(sid))
            if s:
                subject_name = s.get("name") or s.get("title") or subject_name
                subject_color = s.get("color")

        # teacher lookup
        teacher_name, teacher_color = "-", None
        tid = None
        if entry.get("teacherIds"):
            try:
                tid = entry["teacherIds"][0]
            except Exception:
                tid = None
        elif entry.get("teacherId"):
            tid = entry.get("teacherId")
        if tid is not None:
            t = teachers_map.get(str(tid))
            if t:
                teacher_name = t.get("name") or t.get("title") or teacher_name
                teacher_color = t.get("color")

        # class lookup
        class_name, class_color = "-", None
        cid = None
        if entry.get("classIds"):
            try:
                cid = entry["classIds"][0]
            except Exception:
                cid = None
        elif entry.get("classId"):
            cid = entry.get("classId")
        if cid is not None:
            c = classes_map.get(str(cid))
            if c:
                class_name = c.get("name") or c.get("title") or class_name
                class_color = c.get("color")

        slot = {
            "subject": subject_name,
            "subject_color": subject_color,
            "teacher": teacher_name,
            "teacher_color": teacher_color,
            "class": class_name,
            "class_color": class_color,
            "length": entry.get("length", 1),
            "raw": entry,  # keep raw entry for debugging if needed
        }

        # classes grid
        if class_name not in classes_grid:
            classes_grid[class_name] = empty_matrix()
        if 0 <= day_index < len(days) and 0 <= period_index < periods_per_day:
            classes_grid[class_name][day_index][period_index].append(slot)

        # teachers grid
        if teacher_name not in teachers_grid:
            teachers_grid[teacher_name] = empty_matrix()
        if 0 <= day_index < len(days) and 0 <= period_index < periods_per_day:
            teachers_grid[teacher_name][day_index][period_index].append(slot)

    return {
        "days": days,
        "periods": periods,
        "classes_grid": classes_grid,
        "teachers_grid": teachers_grid,
        "subjects_map": subjects_map,
        "raw_meta": {
            "name": raw.get("name")
            or raw.get("generalSettings", {}).get("timetableName")
            or raw.get("title"),
            "id": raw.get("_id") or raw.get("id"),
        },
    }
