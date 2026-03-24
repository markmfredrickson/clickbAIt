"""Live integration tests for Hooktheory TheoryTab. Hits real site.

Run with: pytest tests/ -m live -v
"""

import pytest

from clickbait.sources.hooktheory import lookup_song

pytestmark = pytest.mark.live


def test_known_song_with_key():
    result = lookup_song("Seven Nation Army", "The White Stripes")
    assert result is not None
    assert len(result["keys"]) > 0
    assert any("Minor" in k or "minor" in k for k in result["keys"])


def test_known_song_with_sections():
    result = lookup_song("Billie Jean", "Michael Jackson")
    assert result is not None
    assert len(result["sections"]) > 0


def test_song_not_found():
    result = lookup_song("zzznonexistent12345", "zzzbogus12345")
    assert result is None
