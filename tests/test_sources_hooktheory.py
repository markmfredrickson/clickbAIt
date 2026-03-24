"""Tests for Hooktheory source."""

from unittest.mock import MagicMock, patch

from clickbait.sources.hooktheory import search_song


class TestSearchSong:
    def test_missing_token(self, monkeypatch):
        monkeypatch.delenv("HOOKTHEORY_BEARER_TOKEN", raising=False)
        result = search_song("Test Song")
        assert result is not None
        assert "error" in result

    @patch("clickbait.sources.hooktheory.requests.get")
    def test_no_results(self, mock_get, monkeypatch):
        monkeypatch.setenv("HOOKTHEORY_BEARER_TOKEN", "fake-token")
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = []
        mock_get.return_value = mock_response
        result = search_song("Nonexistent Song")
        assert result is None

    @patch("clickbait.sources.hooktheory.requests.get")
    def test_basic_result(self, mock_get, monkeypatch):
        monkeypatch.setenv("HOOKTHEORY_BEARER_TOKEN", "fake-token")
        search_response = MagicMock()
        search_response.status_code = 200
        search_response.json.return_value = [
            {"ID": "42", "song": "Seven Nation Army", "artist": "The White Stripes"}
        ]
        sections_response = MagicMock()
        sections_response.status_code = 200
        sections_response.json.return_value = [
            {"section": "Verse", "chord_IDs": [1, 5, 4]},
            {"section": "Chorus", "chord_IDs": [1, 4, 5]},
        ]
        mock_get.side_effect = [search_response, sections_response]

        result = search_song("Seven Nation Army", "The White Stripes")
        assert result is not None
        assert result["title"] == "Seven Nation Army"
        assert len(result["sections"]) == 2
        assert result["sections"][0]["name"] == "Verse"

    @patch("clickbait.sources.hooktheory.requests.get")
    def test_api_error(self, mock_get, monkeypatch):
        monkeypatch.setenv("HOOKTHEORY_BEARER_TOKEN", "fake-token")
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_get.return_value = mock_response
        result = search_song("Test")
        assert result is not None
        assert "error" in result
