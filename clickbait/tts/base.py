"""TTS interface — all backends implement generate_cue."""

from pathlib import Path
from typing import Protocol


class TTSBackend(Protocol):
    """Protocol for text-to-speech backends."""

    def generate_cue(self, text: str, output_path: Path, rate: float | None = None) -> Path:
        """Generate a spoken cue audio file.

        Args:
            text: The phrase to speak (e.g. "Verse 1", "Chorus").
            output_path: Where to write the audio file.
            rate: Optional speech rate (interpretation varies by backend).

        Returns:
            Path to the generated audio file.
        """
        ...
