"""Deezer API — BPM and track metadata. No API key required.

Uses deezer-python SDK (https://pypi.org/project/deezer-python/).
"""

import deezer


def search_track(title: str, artist: str | None = None) -> dict | None:
    """Search Deezer for a track. Returns metadata including BPM.

    No API key required. Rate limit: 50 requests / 5 seconds.
    """
    query = f'track:"{title}"'
    if artist:
        query += f' artist:"{artist}"'

    client = deezer.Client()
    try:
        results = client.search(query)
    except deezer.exceptions.DeezerErrorResponse:
        return {"error": "Deezer API error"}

    if not results:
        return None

    track = results[0]
    bpm = track.bpm if track.bpm else None

    return {
        "title": track.title,
        "artist": track.artist.name,
        "album": track.album.title if track.album else None,
        "duration_sec": track.duration,
        "bpm": bpm,
        "gain": track.gain,
        "deezer_id": track.id,
    }
