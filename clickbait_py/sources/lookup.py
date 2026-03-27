"""Batch song lookup — runs all sources in parallel and returns combined results."""

from concurrent.futures import ThreadPoolExecutor, as_completed

from clickbait_py.sources import deezer, genius, hooktheory, musicbrainz


def lookup_song(title: str, artist: str | None = None) -> dict:
    """Look up a song across all sources in parallel.

    Returns a combined dict with results from each source.
    Each source key is None if not found or if an error occurred.
    """
    results = {
        "deezer": None,
        "genius": None,
        "hooktheory": None,
        "musicbrainz": None,
    }

    def _deezer():
        return deezer.search_track(title, artist)

    def _genius():
        return genius.search_lyrics(title, artist)

    def _hooktheory():
        if not artist:
            return None
        return hooktheory.lookup_song(title, artist)

    def _musicbrainz():
        return musicbrainz.search_recording(title, artist)

    tasks = {
        "deezer": _deezer,
        "genius": _genius,
        "hooktheory": _hooktheory,
        "musicbrainz": _musicbrainz,
    }

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(fn): name for name, fn in tasks.items()}
        for future in as_completed(futures):
            name = futures[future]
            try:
                result = future.result()
                if result and not (isinstance(result, dict) and "error" in result):
                    results[name] = result
            except Exception:
                pass  # Source failed, leave as None

    return results


def format_lookup_results(results: dict) -> str:
    """Format batch lookup results as readable text for Claude."""
    lines = []

    mb = results.get("musicbrainz")
    if mb:
        lines.append(f"MusicBrainz: {mb['title']} by {mb['artist']}")
        if mb.get("album"):
            lines.append(f"  Album: {mb['album']}")
        if mb.get("duration"):
            lines.append(f"  Duration: {mb['duration']}")

    dz = results.get("deezer")
    if dz:
        lines.append(f"Deezer: {dz['title']} by {dz['artist']}")
        if dz.get("bpm"):
            lines.append(f"  BPM: {dz['bpm']}")
        if dz.get("duration_sec"):
            mins, secs = divmod(dz["duration_sec"], 60)
            lines.append(f"  Duration: {mins}:{secs:02d}")

    ht = results.get("hooktheory")
    if ht:
        lines.append("Hooktheory TheoryTab:")
        if ht.get("keys"):
            lines.append(f"  Keys: {', '.join(ht['keys'])}")
        if ht.get("sections"):
            lines.append(f"  Sections: {', '.join(ht['sections'])}")

    g = results.get("genius")
    if g:
        lines.append(f"Genius: {g['title']} by {g['artist']}")
        lines.append(f"  Sections found: {len(g['sections'])}")
        for section in g["sections"]:
            lines.append(f"\n  [{section['name']}]")
            lines.append(f"  {section['lyrics']}")

    if not any(results.values()):
        return "No results found from any source."

    return "\n".join(lines)
