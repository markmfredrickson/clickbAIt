"""Live integration tests for Deezer. Hits real API (no key needed).

Run with: pytest tests/ -m live -v
"""

import pytest

from clickbait.sources.deezer import search_track

pytestmark = pytest.mark.live


def test_search_known_song():
    result = search_track("Billie Jean", "Michael Jackson")
    assert result is not None
    assert result["title"] is not None
    assert result["artist"] is not None


def test_bpm_when_available():
    """Deezer has BPM for most but not all tracks."""
    result = search_track("Billie Jean", "Michael Jackson")
    assert result is not None
    assert result["bpm"] is not None
    # Billie Jean is around 117 BPM
    assert 100 < result["bpm"] < 140


def test_bpm_may_be_none():
    """Some tracks don't have BPM data — result should still work."""
    result = search_track("Seven Nation Army", "The White Stripes")
    assert result is not None
    # BPM may or may not be present — just verify the response is valid
    assert result["title"] is not None


def test_search_not_found():
    result = search_track("zzznonexistentsong12345", "zzzbogusartist12345")
    assert result is None
