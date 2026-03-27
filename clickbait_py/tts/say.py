"""macOS `say` command TTS backend."""

import subprocess
from pathlib import Path


class SayBackend:
    """Generate cue audio using macOS text-to-speech."""

    def __init__(self, voice: str = "Samantha"):
        self.voice = voice

    def generate_cue(self, text: str, output_path: Path, rate: float | None = None) -> Path:
        """Generate a spoken cue as an AIFF file using macOS say."""
        output_path = output_path.with_suffix(".aiff")
        cmd = ["say", "-v", self.voice, "-o", str(output_path)]
        if rate is not None:
            cmd.extend(["-r", str(int(rate))])
        cmd.append(text)
        subprocess.run(cmd, check=True)
        return output_path
