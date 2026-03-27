"""Parse REAPER .RPP project files into Song models."""

from pathlib import Path

from clickbait_py.models import Song


def read_rpp(rpp_path: Path) -> Song:
    """Read a REAPER project file and extract song structure.

    TODO: Stub. Will use the rpp library to parse and extract
    markers, regions, tempo map, and media items.
    """
    raise NotImplementedError("RPP reading not yet implemented.")
