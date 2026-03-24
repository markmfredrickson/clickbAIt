"""MusicBrainz API — song and release metadata lookup."""

import musicbrainzngs

musicbrainzngs.set_useragent("clickbAIt", "0.1.0", "https://github.com/clickbait")


def _pick_best_recording(recordings: list[dict]) -> dict:
    """Prefer studio recordings over live/bootleg versions."""
    # Filter out live/bootleg if we have alternatives
    studio = []
    for rec in recordings:
        dis = rec.get("disambiguation", "").lower()
        if "live" not in dis:
            studio.append(rec)
    return studio[0] if studio else recordings[0]


def search_recording(title: str, artist: str | None = None) -> dict | None:
    """Search MusicBrainz for a recording. Returns metadata dict if found."""
    query = title
    if artist:
        query = f'"{title}" AND artist:"{artist}"'

    try:
        result = musicbrainzngs.search_recordings(query=query, limit=10)
    except musicbrainzngs.WebServiceError:
        return None

    recordings = result.get("recording-list", [])
    if not recordings:
        return None

    rec = _pick_best_recording(recordings)
    artist_credit = rec.get("artist-credit", [])
    artist_name = artist_credit[0]["name"] if artist_credit else None

    release_list = rec.get("release-list", [])
    album = release_list[0]["title"] if release_list else None

    duration_ms = int(rec["length"]) if rec.get("length") else None
    duration_str = None
    if duration_ms:
        total_secs = duration_ms // 1000
        duration_str = f"{total_secs // 60}:{total_secs % 60:02d}"

    return {
        "title": rec.get("title"),
        "artist": artist_name,
        "album": album,
        "mbid": rec.get("id"),
        "duration_ms": duration_ms,
        "duration": duration_str,
        "score": int(rec.get("ext:score", 0)),
    }
