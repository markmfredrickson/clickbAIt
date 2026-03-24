"""Tests for MusicBrainz source."""

from unittest.mock import patch

from clickbait.sources.musicbrainz import search_recording


class TestSearchRecording:
    @patch("clickbait.sources.musicbrainz.musicbrainzngs.search_recordings")
    def test_no_results(self, mock_search):
        mock_search.return_value = {"recording-list": []}
        result = search_recording("Nonexistent Song")
        assert result is None

    @patch("clickbait.sources.musicbrainz.musicbrainzngs.search_recordings")
    def test_basic_result(self, mock_search):
        mock_search.return_value = {
            "recording-list": [
                {
                    "id": "abc-123",
                    "title": "Seven Nation Army",
                    "artist-credit": [{"name": "The White Stripes"}],
                    "release-list": [{"title": "Elephant"}],
                    "length": "233000",
                    "ext:score": "100",
                }
            ]
        }
        result = search_recording("Seven Nation Army", "The White Stripes")
        assert result is not None
        assert result["title"] == "Seven Nation Army"
        assert result["artist"] == "The White Stripes"
        assert result["album"] == "Elephant"
        assert result["duration_ms"] == 233000
        assert result["mbid"] == "abc-123"

    @patch("clickbait.sources.musicbrainz.musicbrainzngs.search_recordings")
    def test_missing_optional_fields(self, mock_search):
        mock_search.return_value = {
            "recording-list": [
                {
                    "id": "abc-123",
                    "title": "Some Song",
                    "artist-credit": [],
                    "release-list": [],
                }
            ]
        }
        result = search_recording("Some Song")
        assert result is not None
        assert result["artist"] is None
        assert result["album"] is None
        assert result["duration_ms"] is None

    @patch("clickbait.sources.musicbrainz.musicbrainzngs.search_recordings")
    def test_query_with_artist(self, mock_search):
        mock_search.return_value = {"recording-list": []}
        search_recording("Test", "Artist")
        call_args = mock_search.call_args
        assert "artist:" in call_args.kwargs["query"]
