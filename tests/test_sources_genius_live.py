"""Live integration tests for Genius source. Hit real API.

Run with: pytest tests/ -m live -v
Requires GENIUS_API_TOKEN in .env
"""

import os

import pytest

from clickbait.sources.genius import search_lyrics

pytestmark = pytest.mark.live


@pytest.fixture(autouse=True)
def _require_token():
    if not os.environ.get("GENIUS_API_TOKEN"):
        pytest.skip("GENIUS_API_TOKEN not set")


def test_search_known_song():
    result = search_lyrics("Seven Nation Army", "The White Stripes")
    assert result is not None
    assert result["title"] == "Seven Nation Army"
    assert result["artist"] == "The White Stripes"
    assert len(result["sections"]) > 0


def test_sections_have_lyrics():
    result = search_lyrics("Seven Nation Army", "The White Stripes")
    verse_sections = [s for s in result["sections"] if "Verse" in s["name"]]
    assert len(verse_sections) > 0
    assert len(verse_sections[0]["lyrics"]) > 0


def test_search_not_found():
    result = search_lyrics("zzznonexistentsong12345", "zzzbogusartist12345")
    assert result is None
