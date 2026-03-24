"""Genius API — lyrics with section markers."""

import os
import re

import lyricsgenius


def _parse_sections(lyrics: str) -> list[dict]:
    """Parse Genius lyrics text into sections based on [Marker] annotations."""
    sections = []
    current_name = None
    current_lines = []

    for line in lyrics.splitlines():
        marker = re.match(r"^\[(.+)\]$", line.strip())
        if marker:
            if current_name is not None:
                sections.append({
                    "name": current_name,
                    "lyrics": "\n".join(current_lines).strip(),
                })
            current_name = marker.group(1)
            current_lines = []
        elif current_name is not None:
            current_lines.append(line)

    # Final section
    if current_name is not None:
        sections.append({
            "name": current_name,
            "lyrics": "\n".join(current_lines).strip(),
        })

    return sections


def search_lyrics(title: str, artist: str | None = None) -> dict | None:
    """Search Genius for lyrics. Returns dict with title, artist, lyrics, and sections.

    Requires GENIUS_API_TOKEN in environment.
    """
    token = os.environ.get("GENIUS_API_TOKEN")
    if not token:
        return {"error": "GENIUS_API_TOKEN not set in .env"}

    genius = lyricsgenius.Genius(token, verbose=False, remove_section_headers=False)
    song = genius.search_song(title, artist=artist or "")
    if song is None:
        return None

    sections = _parse_sections(song.lyrics)

    return {
        "title": song.title,
        "artist": song.artist,
        "lyrics": song.lyrics,
        "sections": sections,
    }
