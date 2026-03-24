"""Hooktheory API — song structure and chord progressions."""

import os

import requests


API_BASE = "https://api.hooktheory.com/v1"


def _get_headers() -> dict | None:
    """Get auth headers for Hooktheory API."""
    bearer = os.environ.get("HOOKTHEORY_BEARER_TOKEN")
    if bearer:
        return {"Authorization": f"Bearer {bearer}"}
    return None


def search_song(title: str, artist: str | None = None) -> dict | None:
    """Search Hooktheory for song structure and chords.

    Requires HOOKTHEORY_BEARER_TOKEN in environment.
    Returns labeled sections with chord progressions.
    """
    headers = _get_headers()
    if headers is None:
        return {"error": "HOOKTHEORY_BEARER_TOKEN not set in .env"}

    params = {"term": title}
    resp = requests.get(f"{API_BASE}/trends/songs", headers=headers, params=params)
    if resp.status_code != 200:
        return {"error": f"Hooktheory API returned {resp.status_code}"}

    songs = resp.json()
    if not songs:
        return None

    # Find best match (optionally filter by artist)
    match = songs[0]
    for song in songs:
        if artist and artist.lower() in song.get("artist", "").lower():
            match = song
            break

    # Fetch sections for the matched song
    song_id = match.get("ID")
    if not song_id:
        return {
            "title": match.get("song"),
            "artist": match.get("artist"),
            "sections": [],
        }

    sections_resp = requests.get(
        f"{API_BASE}/trends/songs/{song_id}", headers=headers
    )
    sections = sections_resp.json() if sections_resp.status_code == 200 else []

    return {
        "title": match.get("song"),
        "artist": match.get("artist"),
        "sections": [
            {
                "name": s.get("section"),
                "chords": s.get("chord_IDs", []),
            }
            for s in sections
        ],
    }
