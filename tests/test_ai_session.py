"""Tests for AI session tool handling, commands, and conversation flow."""

from types import SimpleNamespace
from unittest.mock import MagicMock

from clickbait.ai.session import ChatSession, handle_tool_call, _format_lyrics_result
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
        assert self.song.artist is None

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
        assert "\\n" not in formatted


class TestHandleCommand:
    def setup_method(self):
        self.session = ChatSession(client=MagicMock())

    def test_verbose_toggle(self):
        assert self.session.verbose is False
        result = self.session.handle_command("/verbose")
        assert self.session.verbose is True
        assert "on" in result
        result = self.session.handle_command("/verbose")
        assert self.session.verbose is False
        assert "off" in result

    def test_song_empty(self):
        result = self.session.handle_command("/song")
        assert "Untitled" in result
        assert "Sections: 0" in result

    def test_song_with_data(self):
        self.session.song.title = "Test"
        self.session.song.artist = "Band"
        self.session.song.bpm = 120
        self.session.song.sections = [Section("Verse", 8, lyrics="Hello")]
        result = self.session.handle_command("/song")
        assert "Test" in result
        assert "120" in result
        assert "Verse" in result
        assert "[lyrics]" in result

    def test_help(self):
        result = self.session.handle_command("/help")
        assert "/verbose" in result
        assert "/song" in result

    def test_unknown_command(self):
        result = self.session.handle_command("/bogus")
        assert result is None


def _make_text_block(text):
    return SimpleNamespace(type="text", text=text)


def _make_tool_use_block(name, input_args, tool_id="tool-1"):
    return SimpleNamespace(type="tool_use", name=name, input=input_args, id=tool_id)


class TestProcessTurn:
    def test_text_only_response(self):
        mock_client = MagicMock()
        mock_client.messages.create.return_value = SimpleNamespace(
            content=[_make_text_block("Hello! How can I help?")]
        )
        session = ChatSession(client=mock_client)
        outputs = session.process_turn("hi")
        assert len(outputs) == 1
        assert outputs[0]["type"] == "text"
        assert "Hello" in outputs[0]["content"]
        assert len(session.messages) == 2  # user + assistant

    def test_tool_call_then_text(self):
        mock_client = MagicMock()
        # First response: tool call
        tool_response = SimpleNamespace(
            content=[_make_tool_use_block("set_song_metadata", {"title": "Test Song"})]
        )
        # Second response: text after tool result
        text_response = SimpleNamespace(
            content=[_make_text_block("I've set the title to Test Song.")]
        )
        mock_client.messages.create.side_effect = [tool_response, text_response]

        session = ChatSession(client=mock_client)
        outputs = session.process_turn("let's work on Test Song")

        assert len(outputs) == 2
        assert outputs[0]["type"] == "tool_call"
        assert outputs[0]["name"] == "set_song_metadata"
        assert "Test Song" in outputs[0]["result"]
        assert outputs[1]["type"] == "text"
        assert session.song.title == "Test Song"
        # user + assistant(tool) + user(tool_result) + assistant(text)
        assert len(session.messages) == 4

    def test_multiple_tool_calls_in_one_response(self):
        mock_client = MagicMock()
        # Response with two tool calls
        tool_response = SimpleNamespace(
            content=[
                _make_tool_use_block("set_song_metadata", {"title": "Test", "bpm": 120}, "tool-1"),
                _make_tool_use_block("set_song_structure", {
                    "sections": [{"name": "Verse", "measures": 8}]
                }, "tool-2"),
            ]
        )
        text_response = SimpleNamespace(
            content=[_make_text_block("All set!")]
        )
        mock_client.messages.create.side_effect = [tool_response, text_response]

        session = ChatSession(client=mock_client)
        outputs = session.process_turn("set up Test at 120 bpm with a verse")

        tool_outputs = [o for o in outputs if o["type"] == "tool_call"]
        assert len(tool_outputs) == 2
        assert session.song.title == "Test"
        assert session.song.bpm == 120
        assert len(session.song.sections) == 1

    def test_messages_accumulate_across_turns(self):
        mock_client = MagicMock()
        mock_client.messages.create.return_value = SimpleNamespace(
            content=[_make_text_block("Response")]
        )
        session = ChatSession(client=mock_client)
        session.process_turn("first message")
        session.process_turn("second message")
        # 2 turns × (user + assistant) = 4 messages
        assert len(session.messages) == 4
        assert session.messages[0]["content"] == "first message"
        assert session.messages[2]["content"] == "second message"
