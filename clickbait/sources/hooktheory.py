"""Hooktheory TheoryTab — key and song section data via page scraping.

No API key required. Scrapes the public TheoryTab page for key signatures
and section structure. Coverage depends on community contributions (~72k songs).
"""

import re

import requests
from bs4 import BeautifulSoup


THEORYTAB_BASE = "https://www.hooktheory.com/theorytab/view"


def _slugify(text: str) -> str:
    """Convert text to URL slug format matching TheoryTab conventions."""
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def lookup_song(title: str, artist: str) -> dict | None:
    """Look up a song on TheoryTab for key and section data.

    Requires both title and artist to construct the URL slug.
    Returns None if the song isn't in the database.
    """
    artist_slug = _slugify(artist)
    song_slug = _slugify(title)
    url = f"{THEORYTAB_BASE}/{artist_slug}/{song_slug}"

    resp = requests.get(url, timeout=10)
    if resp.status_code != 200:
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    # Extract keys
    keys = []
    key_text = soup.find(string=re.compile("analyzed in the following keys"))
    if key_text:
        parent = key_text.find_parent("p")
        if parent:
            keys = [
                a.text.strip()
                for a in parent.find_all("a")
                if "cheat-sheet/key" in a.get("href", "")
            ]

    # Extract sections from anchor links to #section-name
    section_links = soup.find_all("a", href=re.compile(f"{song_slug}#"))
    seen = set()
    sections = []
    for link in section_links:
        span = link.find("span")
        if span:
            name = span.text.strip()
            if name and name not in seen:
                sections.append(name)
                seen.add(name)

    if not keys and not sections:
        return None

    return {
        "title": title,
        "artist": artist,
        "keys": keys,
        "sections": sections,
        "url": url,
    }
