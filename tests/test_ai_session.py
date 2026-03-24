"""Tests for AI session tool handling and slash commands."""

from clickbait.ai.session import handle_tool_call, _format_lyrics_result
from clickbait.models import Section, Song


class TestHandleToolCall:
    def setup_method(self):
        self.song = Song(title="Untitled")

    def test_set_song_metadata_title_only(self):
        result = handle_tool_call(self.song, "set_song_metadata", {"title": "Test Song"})
        assert self.song.title == "Test Song"
        assert "Test Song" in result

    def test_set_song_metadata_full(self):
        handle_tool_call(self.song, "set_song_metadata", {
            "title": "My Song",
            "artist": "The Band",
            "bpm": 120,
            "key": "C major",
            "time_signature": [3, 4],
        })
        assert self.song.title == "My Song"
        assert self.song.artist == "The Band"
        assert self.song.bpm == 120
        assert self.song.key == "C major"
        assert self.song.time_signature == (3, 4)

    def test_set_song_metadata_partial_update(self):
        self.song.title = "Existing"
        self.song.bpm = 100
        handle_tool_call(self.song, "set_song_metadata", {"title": "Existing", "bpm": 140})
        assert self.song.bpm == 140
        assert self.song.artist is None  # unchanged

    def test_set_song_structure(self):
        result = handle_tool_call(self.song, "set_song_structure", {
            "sections": [
                {"name": "Intro", "measures": 4},
                {"name": "Verse", "measures": 8},
                {"name": "Chorus", "measures": 8},
                {"name": "Verse", "measures": 8},
            ]
        })
        assert len(self.song.sections) == 4
        assert self.song.sections[0].name == "Intro"
        assert self.song.sections[1].measures == 8
        assert "Verse 1" in result
        assert "Verse 2" in result

    def test_set_song_structure_replaces_existing(self):
        self.song.sections = [Section("Old", 4)]
        handle_tool_call(self.song, "set_song_structure", {
            "sections": [{"name": "New", "measures": 8}]
        })
        assert len(self.song.sections) == 1
        assert self.song.sections[0].name == "New"

    def test_set_section_lyrics(self):
        self.song.sections = [Section("Verse", 8), Section("Chorus", 8)]
        result = handle_tool_call(self.song, "set_section_lyrics", {
            "section_index": 0, "lyrics": "Hello world"
        })
        assert self.song.sections[0].lyrics == "Hello world"
        assert "Verse" in result

    def test_set_section_lyrics_out_of_range(self):
        self.song.sections = [Section("Verse", 8)]
        result = handle_tool_call(self.song, "set_section_lyrics", {
            "section_index": 5, "lyrics": "Nope"
        })
        assert "out of range" in result

    def test_unknown_tool(self):
        result = handle_tool_call(self.song, "bogus_tool", {})
        assert "Unknown tool" in result

    def test_lookup_lyrics_missing_token(self, monkeypatch):
        monkeypatch.delenv("GENIUS_API_TOKEN", raising=False)
        result = handle_tool_call(self.song, "lookup_lyrics", {"title": "Test"})
        assert "GENIUS_API_TOKEN" in result


class TestFormatLyricsResult:
    def test_basic_format(self):
        result = {
            "title": "Test Song",
            "artist": "Test Artist",
            "lyrics": "[Verse]\nHello\n[Chorus]\nWorld",
            "sections": [
                {"name": "Verse", "lyrics": "Hello"},
                {"name": "Chorus", "lyrics": "World"},
            ],
        }
        formatted = _format_lyrics_result(result)
        assert "Title: Test Song" in formatted
        assert "Artist: Test Artist" in formatted
        assert "[Verse]" in formatted
        assert "Hello" in formatted
        assert "[Chorus]" in formatted
        assert "World" in formatted
        # Should contain actual newlines, not \n literals
        assert "\\n" not in formatted
