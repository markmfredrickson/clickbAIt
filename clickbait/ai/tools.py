"""Claude tool definitions for building song projects."""

TOOLS = [
    {
        "name": "set_song_metadata",
        "description": (
            "Set or update the song's basic metadata: title, artist, BPM, key, "
            "and time signature."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Song title"},
                "artist": {"type": "string", "description": "Artist or band name"},
                "bpm": {"type": "number", "description": "Beats per minute"},
                "key": {
                    "type": "string",
                    "description": "Musical key (e.g. 'C major', 'F# minor')",
                },
                "time_signature": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "description": "Time signature as [numerator, denominator], e.g. [4, 4]",
                },
            },
            "required": ["title"],
        },
    },
    {
        "name": "set_song_structure",
        "description": (
            "Define the full song structure as an ordered list of sections. "
            "Each section has a name and a length in measures. "
            "This replaces any previously defined structure."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sections": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {
                                "type": "string",
                                "description": "Section name (e.g. Verse, Chorus, Bridge)",
                            },
                            "measures": {
                                "type": "integer",
                                "description": "Number of measures in this section",
                            },
                        },
                        "required": ["name", "measures"],
                    },
                    "description": "Ordered list of song sections",
                },
            },
            "required": ["sections"],
        },
    },
    {
        "name": "set_section_lyrics",
        "description": "Attach lyrics to a specific section by index (0-based).",
        "input_schema": {
            "type": "object",
            "properties": {
                "section_index": {
                    "type": "integer",
                    "description": "Index of the section in the structure (0-based)",
                },
                "lyrics": {"type": "string", "description": "Lyrics text for this section"},
            },
            "required": ["section_index", "lyrics"],
        },
    },
    {
        "name": "lookup_lyrics",
        "description": (
            "Search Genius for song lyrics. Returns lyrics text with section markers "
            "like [Verse], [Chorus], etc. Use this when the user asks to find or add lyrics."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Song title"},
                "artist": {"type": "string", "description": "Artist name (improves accuracy)"},
            },
            "required": ["title"],
        },
    },
]
