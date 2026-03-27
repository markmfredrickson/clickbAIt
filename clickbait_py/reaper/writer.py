"""Generate REAPER .RPP project files from Song models."""

from pathlib import Path

from clickbait_py.models import Song


def measures_to_seconds(measure: int, bpm: float, beats_per_measure: int = 4) -> float:
    """Convert a 1-based measure number to seconds."""
    return (measure - 1) * beats_per_measure * (60.0 / bpm)


def write_rpp(song: Song, output_path: Path) -> Path:
    """Write a REAPER project file for the given song.

    TODO: This is a stub. Real implementation will use the rpp library
    and a template-based approach once we have a reference .RPP from REAPER.
    """
    raise NotImplementedError(
        "RPP generation requires a reference template. "
        "Create a sample project in REAPER first."
    )
