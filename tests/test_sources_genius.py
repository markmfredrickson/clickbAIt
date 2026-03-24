"""Tests for Genius lyrics source."""

from unittest.mock import MagicMock, patch

from clickbait.sources.genius import _parse_sections, search_lyrics


class TestParseSections:
    def test_basic_sections(self):
        lyrics = "[Verse 1]\nHello world\nSecond line\n\n[Chorus]\nLa la la\n"
        sections = _parse_sections(lyrics)
        assert len(sections) == 2
        assert sections[0]["name"] == "Verse 1"
        assert sections[0]["lyrics"] == "Hello world\nSecond line"
        assert sections[1]["name"] == "Chorus"
        assert sections[1]["lyrics"] == "La la la"

    def test_empty_lyrics(self):
        assert _parse_sections("") == []

    def test_no_markers(self):
        assert _parse_sections("Just some text\nwithout markers") == []

    def test_multiple_same_sections(self):
        lyrics = "[Verse 1]\nFirst verse\n[Chorus]\nChorus text\n[Verse 2]\nSecond verse\n"
        sections = _parse_sections(lyrics)
        assert len(sections) == 3
        assert sections[0]["name"] == "Verse 1"
        assert sections[2]["name"] == "Verse 2"

    def test_empty_section(self):
        lyrics = "[Intro]\n[Verse 1]\nSome lyrics\n"
        sections = _parse_sections(lyrics)
        assert len(sections) == 2
        assert sections[0]["name"] == "Intro"
        assert sections[0]["lyrics"] == ""


class TestSearchLyrics:
    def test_missing_token(self, monkeypatch):
        monkeypatch.delenv("GENIUS_API_TOKEN", raising=False)
        result = search_lyrics("Test Song")
        assert result is not None
        assert "error" in result

    @patch("clickbait.sources.genius.lyricsgenius.Genius")
    def test_song_not_found(self, mock_genius_cls, monkeypatch):
        monkeypatch.setenv("GENIUS_API_TOKEN", "fake-token")
        mock_genius_cls.return_value.search_song.return_value = None
        result = search_lyrics("Nonexistent Song")
        assert result is None

    @patch("clickbait.sources.genius.lyricsgenius.Genius")
    def test_song_found(self, mock_genius_cls, monkeypatch):
        monkeypatch.setenv("GENIUS_API_TOKEN", "fake-token")
        mock_song = MagicMock()
        mock_song.title = "Test Song"
        mock_song.artist = "Test Artist"
        mock_song.lyrics = "[Verse 1]\nHello\n[Chorus]\nWorld\n"
        mock_genius_cls.return_value.search_song.return_value = mock_song

        result = search_lyrics("Test Song", "Test Artist")
        assert result is not None
        assert result["title"] == "Test Song"
        assert result["artist"] == "Test Artist"
        assert len(result["sections"]) == 2
        assert result["sections"][0]["name"] == "Verse 1"
