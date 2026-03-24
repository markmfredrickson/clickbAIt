"""Tests for core data models."""

from clickbait.models import Section, Song


def test_numbered_section_name_unique():
    song = Song(title="Test", sections=[Section("Intro", 4), Section("Verse", 8)])
    assert song.numbered_section_name(0) == "Intro"
    assert song.numbered_section_name(1) == "Verse"


def test_numbered_section_name_repeated():
    song = Song(
        title="Test",
        sections=[
            Section("Verse", 8),
            Section("Chorus", 8),
            Section("Verse", 8),
            Section("Chorus", 8),
        ],
    )
    assert song.numbered_section_name(0) == "Verse 1"
    assert song.numbered_section_name(1) == "Chorus 1"
    assert song.numbered_section_name(2) == "Verse 2"
    assert song.numbered_section_name(3) == "Chorus 2"


def test_section_start_measure():
    song = Song(
        title="Test",
        sections=[Section("Intro", 4), Section("Verse", 8), Section("Chorus", 8)],
    )
    assert song.section_start_measure(0) == 1
    assert song.section_start_measure(1) == 5
    assert song.section_start_measure(2) == 13
