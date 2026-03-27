"""Core data models for songs, sections, and project structure."""

from dataclasses import dataclass, field


@dataclass
class Section:
    """A section of a song (e.g. Verse, Chorus, Bridge)."""

    name: str
    measures: int
    lyrics: str | None = None


@dataclass
class Song:
    """A song with its metadata and structure."""

    title: str
    artist: str | None = None
    bpm: float | None = None
    time_signature: tuple[int, int] = (4, 4)
    key: str | None = None
    sections: list[Section] = field(default_factory=list)

    def numbered_section_name(self, index: int) -> str:
        """Return section name with instance number (e.g. 'Verse 2') if repeated."""
        section = self.sections[index]
        same_name = [i for i, s in enumerate(self.sections) if s.name == section.name]
        if len(same_name) == 1:
            return section.name
        instance = same_name.index(index) + 1
        return f"{section.name} {instance}"

    def section_start_measure(self, index: int) -> int:
        """Return the starting measure number (1-based) for a section."""
        return 1 + sum(s.measures for s in self.sections[:index])
