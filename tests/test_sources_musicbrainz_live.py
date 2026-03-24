"""Live integration tests for MusicBrainz. Hits real API (no key needed).

Run with: pytest tests/ -m live -v
"""

import pytest

from clickbait.sources.musicbrainz import search_recording

pytestmark = pytest.mark.live


def test_search_known_song():
    result = search_recording("Seven Nation Army", "The White Stripes")
    assert result is not None
    assert "seven nation army" in result["title"].lower()
    assert "white stripes" in result["artist"].lower()
    assert result["mbid"] is not None


def test_search_with_duration():
    result = search_recording("Rich Girl", "Hall & Oates")
    assert result is not None
    assert result["duration_ms"] is not None
    assert result["duration_ms"] > 0


def test_search_not_found():
    result = search_recording("zzznonexistentsong12345", "zzzbogusartist12345")
    assert result is None
