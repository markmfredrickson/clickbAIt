"""Tests for Deezer source."""

from unittest.mock import MagicMock, patch

from clickbait.sources.deezer import search_track


def _mock_track(title="Test", artist="Artist", album="Album", duration=200, bpm=120.0, gain=-10.0, track_id=123):
    track = MagicMock()
    track.title = title
    track.artist.name = artist
    track.album.title = album
    track.duration = duration
    track.bpm = bpm
    track.gain = gain
    track.id = track_id
    return track


class TestSearchTrack:
    @patch("clickbait.sources.deezer.deezer.Client")
    def test_no_results(self, mock_client_cls):
        mock_client_cls.return_value.search.return_value = []
        result = search_track("Nonexistent Song")
        assert result is None

    @patch("clickbait.sources.deezer.deezer.Client")
    def test_basic_result(self, mock_client_cls):
        mock_client_cls.return_value.search.return_value = [
            _mock_track(title="Billie Jean", artist="Michael Jackson", bpm=117.1)
        ]
        result = search_track("Billie Jean", "Michael Jackson")
        assert result is not None
        assert result["title"] == "Billie Jean"
        assert result["bpm"] == 117.1
        assert result["duration_sec"] == 200

    @patch("clickbait.sources.deezer.deezer.Client")
    def test_bpm_zero_becomes_none(self, mock_client_cls):
        mock_client_cls.return_value.search.return_value = [_mock_track(bpm=0)]
        result = search_track("Test")
        assert result["bpm"] is None

    @patch("clickbait.sources.deezer.deezer.Client")
    def test_bpm_none_stays_none(self, mock_client_cls):
        mock_client_cls.return_value.search.return_value = [_mock_track(bpm=None)]
        result = search_track("Test")
        assert result["bpm"] is None

    @patch("clickbait.sources.deezer.deezer.Client")
    def test_api_error(self, mock_client_cls):
        import deezer as deezer_mod
        mock_client_cls.return_value.search.side_effect = deezer_mod.exceptions.DeezerErrorResponse("err")
        result = search_track("Test")
        assert result is not None
        assert "error" in result

    @patch("clickbait.sources.deezer.deezer.Client")
    def test_query_includes_artist(self, mock_client_cls):
        mock_client_cls.return_value.search.return_value = []
        search_track("Test", "Artist")
        call_args = mock_client_cls.return_value.search.call_args
        assert 'artist:"Artist"' in call_args.args[0]
