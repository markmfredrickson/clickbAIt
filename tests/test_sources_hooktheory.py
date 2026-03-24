"""Tests for Hooktheory TheoryTab source."""

from unittest.mock import MagicMock, patch

from clickbait.sources.hooktheory import _slugify, lookup_song


class TestSlugify:
    def test_basic(self):
        assert _slugify("The White Stripes") == "the-white-stripes"

    def test_special_chars(self):
        assert _slugify("Hall & Oates") == "hall-oates"

    def test_apostrophe(self):
        assert _slugify("Don't Stop Believin'") == "don-t-stop-believin"

    def test_leading_trailing(self):
        assert _slugify("  Hello World  ") == "hello-world"


class TestLookupSong:
    @patch("clickbait.sources.hooktheory.requests.get")
    def test_not_found(self, mock_get):
        mock_get.return_value = MagicMock(status_code=404)
        result = lookup_song("Nonexistent", "Nobody")
        assert result is None

    @patch("clickbait.sources.hooktheory.requests.get")
    def test_page_with_keys_and_sections(self, mock_get):
        html = """
        <html><body>
        <p>Song has sections analyzed in the following keys:
            <a href="/cheat-sheet/key/e/minor">E Minor</a>,
            <a href="/cheat-sheet/key/e/dorian">E Dorian</a>
        </p>
        <a href="/theorytab/view/the-white-stripes/seven-nation-army#intro">
            <span>Intro</span>
        </a>
        <a href="/theorytab/view/the-white-stripes/seven-nation-army#verse">
            <span>Verse</span>
        </a>
        <a href="/theorytab/view/the-white-stripes/seven-nation-army#chorus">
            <span>Chorus</span>
        </a>
        </body></html>
        """
        mock_resp = MagicMock(status_code=200, text=html)
        mock_get.return_value = mock_resp

        result = lookup_song("Seven Nation Army", "The White Stripes")
        assert result is not None
        assert result["keys"] == ["E Minor", "E Dorian"]
        assert result["sections"] == ["Intro", "Verse", "Chorus"]
        assert "seven-nation-army" in result["url"]

    @patch("clickbait.sources.hooktheory.requests.get")
    def test_page_with_no_data(self, mock_get):
        html = "<html><body><p>Nothing useful here</p></body></html>"
        mock_get.return_value = MagicMock(status_code=200, text=html)
        result = lookup_song("Test", "Artist")
        assert result is None

    @patch("clickbait.sources.hooktheory.requests.get")
    def test_deduplicates_sections(self, mock_get):
        html = """
        <html><body>
        <a href="/theorytab/view/artist/song#verse"><span>Verse</span></a>
        <a href="/theorytab/view/artist/song#verse"><span>Verse</span></a>
        <a href="/theorytab/view/artist/song#chorus"><span>Chorus</span></a>
        </body></html>
        """
        mock_get.return_value = MagicMock(status_code=200, text=html)
        result = lookup_song("Song", "Artist")
        assert result is not None
        assert result["sections"] == ["Verse", "Chorus"]
