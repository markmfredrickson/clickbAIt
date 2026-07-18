# Song manifest — format & authoring

Read this at Step 4 of the clickbait skill, when authoring or reviewing a
`<song-slug>.song.json`. The manifest is inert JSON (`schema: "clickbait/song@1"`)
validated by the zod schema in `src/manifest.ts` — that file is the source of
truth; the generated JSON Schema at the bottom of this doc mirrors it.

## Skeleton

```json
{
  "schema": "clickbait/song@1",
  "title": "Song Title",
  "artist": "Artist",
  "key": "Bb",
  "bpm": 120,
  "timeSignature": [4, 4],
  "preRollBars": 1,
  "ringOutBars": 0,
  "sources": {
    "recording": {
      "kind": "audio",
      "file": "source.m4a",
      "beatMap": [{ "startBeat": 0, "times": [0.56, 1.18, 1.79, 2.40] }]
    },
    "stems": {
      "kind": "audio-group",
      "curveRef": "recording",
      "produced-by": "clickbait-audio split --model 4stem",
      "dir": "stems/",
      "files": { "vocals": "source_vocals.wav", "drums": "source_drums.wav", "bass": "source_bass.wav", "other": "source_other.wav" }
    }
  },
  "songCurve": "constantBpm",
  "sections": [
    { "name": "Intro", "bars": 4, "cue": true },
    {
      "name": "Verse 1", "bars": 16, "cue": true,
      "lines": [{ "text": "First line of the verse", "tag": "Lead Vocal" }]
    }
  ],
  "lyrics": { "alignment": { "file": "stems/source_vocals.align.json", "produced-by": "clickbait-audio align" } }
}
```

## Fields

- **`bpm`** — full decimal precision (e.g. `107.1429`). **`timeSignature`** — `[numerator, denominator]`, the song default.
- **`preRollBars`** — whole bars of count-in before the downbeat (a musical lead-in, NOT a silence trim). **`ringOutBars`** — bars the stems keep playing past the last section (natural decay for songs that end on a hit).
- **`sources.recording.beatMap`** — where each song beat lands in the source, as `source-second ↔ song-beat` control points. A `{ "startBeat": n, "times": [...] }` run pins consecutive beats (`stride` > 1 pins every Nth and lets the rest float); a `{ "beat": n, "t": s }` pin fixes one point. Pin every beat to follow the recording's micro-timing; leave a gap and those beats interpolate linearly (a deliberate stretch, e.g. a rubato intro compressed into fewer bars). `startBeat` is negative for a pickup. Usually a ref to the `<source>.beatmap.json` sidecar, which `beats:smooth` produces from the raw beats + the anchor below.
- **`sources.recording.startBeat`** — the anchor for the raw detected beats: which song beat the FIRST detected beat lands on (negative for a pickup — e.g. `-2` for a 2-beat count-in before the downbeat at 0). `beats:smooth` reads it to turn `<source>.beats.json` into the `beatMap` sidecar; it's the one authored value detection can't infer. Defaults to 0.
- **`sources.stems`** — `curveRef: "recording"` (share the recording's curve), `dir`, `files` (role → filename). `soffs` trims silence off every stem start; `sourceEnd` caps the end; `clips` assemble a track from source regions (repeat/rearrange). Paths are relative to the manifest.
- **`lyrics.alignment`** — the only lyric file ref (measured per-word timing). The line *text* lives in the sections.
- **`cues`** — points at the folder of generated spoken-cue audio.

## Sections

Sections are an ordered list starting at bar 1, running back-to-back. **Only `bars` places a section** — its start beat is the running total of the sections before it; never author an absolute start.

- **`name`** (spoken if `cue`), **`bars`** (length — the only placement field).
- **`cue: true`** — auto-announce the section name (spoken 2 bars before, count-in 1 bar before).
- **`lines`** — the lyric lines belonging to this section, in sung order. Nesting makes membership explicit (a pickup line sung before the downbeat still groups with its section). Across all sections, `lines` in order is the flat lyric fed to the aligner, so the order must match. A line is normally just `text` (+ `tag`, e.g. `"Lead Vocal"`); `b`/`t` are rare manual overrides for when alignment fails. Instrumental sections omit `lines`.
- **`timeSignature`** — per-section meter override (e.g. a 6/8 bridge or a 2/4 pickup bar).
- **`smStride`** — stretch-marker stride: `4` in 4/4 pins only downbeats (loose/rubato feel); `0` emits no markers (audio plays 1:1). **`stretchMarkers`** — verbatim hand-tuned `(item, source)` pairs for a captured loose intro.
- **`cues`** — manual spoken cues at `{ "at": <beat-relative-to-section-start>, "label": "..." }` (`at` may be negative — a pickup before the downbeat).

### Authoring rules

- **Favor even bar counts, and multiples of 8** (8, 16, 24, 32). Most popular songs are built from 8- and 16-bar phrases, so an even/×8 guess is usually right and leaves only a few genuinely-odd sections to fix. Keep a real 6- or 10-bar phrase or an odd pickup bar where the song has one — but even/×8 is the default. (The scaffolder emits a placeholder `bars: 8`; set the real value.)
- **Author the song as it actually starts** — first section can be `Intro`, `Verse 1`, `Chorus`, anything. No reserved bars.

**Slug vs. Intro — don't confuse these:**
- **Slug** — an auto-inserted region at the top of the RPP (generator-owned) holding the title announcement. Never authored; appears at build time.
- **Intro** — the author's *musical* introduction, a regular section. A song can skip it and open on a verse.

## Instrumental sections Genius doesn't label

Genius only marks sections with sung lyrics, so anything purely instrumental is invisible and the scaffolder won't emit it. When there's a gap of `≥ 2 bars` between two lyric sections (or before the first / after the last), suggest an instrumental section and ask the user:

| Where | Typical name | Typical length | Notes |
| --- | --- | --- | --- |
| Before first vocal | `Intro` | 4–16 bars | If Genius opens with `[Intro]` containing a vocal line, extend that section back instead. |
| Verse → Chorus | `Pre-Chorus` or `Ramp` | 2–4 bars | `Ramp` if it's ≤ 2 bars and feels like a transition. |
| Chorus → Verse | `Post-Chorus` or `Re-intro` | 2–8 bars | `Post-Chorus` if it tails off the chorus riff; `Re-intro` if it restates the intro. |
| Chorus → Bridge | `Post-Chorus` or `Break` | 2–8 bars | If it's a drum/guitar breakdown, `Break` reads better. |
| Bridge → Chorus | `Pre-Chorus` or `Ramp` | 2–4 bars | Same as Verse → Chorus. |
| Verse → Verse (rare) | `Instrumental` | 4–16 bars | Usually an implicit Chorus or Solo the transcriber dropped. |
| After last vocal | `Outro` | 4–32 bars | Extend to song end. If Genius labels `[Outro]` with a vocal line, extend that section. |

Starting points — the band's chart wins. Flag each with a one-line prompt (*"~18 bars of instrumental between Verse 1 and Verse 2 — `Instrumental`, `Guitar Solo`, or split it?"*) and default to the table if the user says "you pick."

## Cues and count-ins

- **Cues land on the beat by perceptual center.** The generate step positions each spoken cue so the *felt* beat of the word — its vowel/sonorant onset, not the acoustic start — lands on the beat (count numbers hit on the beat; a section-name pickup resolves onto the "1"). Automatic; you just place the cue. Spell tricky labels phonetically for Piper TTS (e.g. `"F sharp"`).
- Use `cue: true` for section announcements; use manual `cues` only for ad-hoc band cues and count-ins.

**Exception — time changes at the lead-in.** Auto count-ins assume the bar before a section matches that section's meter, so they mis-count across ANY time-signature change at the boundary (a 2/4+3/4 turnaround into a chorus, or a lone 2/4 bar before a 4/4 section). When the bar(s) immediately before a section change meter, do NOT set `cue: true` on it. Hand-place manual cues relative to its downbeat: announce the name ~2 bars out, count each real bar in its own meter, land "1" at `at: 0`. Example for a 2/4-then-3/4 turnaround:

```json
"cues": [{"at":-8,"label":"Chorus 1"},{"at":-5,"label":"1"},{"at":-4,"label":"2"},{"at":-3,"label":"1"},{"at":-2,"label":"2"},{"at":-1,"label":"3"},{"at":0,"label":"1"}]
```

— speaks "Chorus 1 … 1 2, 1 2 3, 1".

## Full schema

Generated from `src/manifest.ts` (zod → JSON Schema). The source file is authoritative; read it for exact constraints and inline comments.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "schema": {
      "type": "string",
      "const": "clickbait/song@1"
    },
    "title": {
      "type": "string",
      "minLength": 1
    },
    "artist": {
      "type": "string"
    },
    "key": {
      "type": "string"
    },
    "bpm": {
      "type": "number",
      "exclusiveMinimum": 0
    },
    "timeSignature": {
      "type": "array",
      "prefixItems": [
        {
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 9007199254740991
        },
        {
          "type": "integer",
          "exclusiveMinimum": 0,
          "maximum": 9007199254740991
        }
      ]
    },
    "preRollBars": {
      "default": 0,
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "ringOutBars": {
      "default": 0,
      "type": "number",
      "minimum": 0
    },
    "metadata": {
      "type": "object",
      "properties": {
        "file": {
          "type": "string",
          "minLength": 1
        },
        "produced-by": {
          "type": "string",
          "minLength": 1
        },
        "edited": {
          "type": "boolean"
        }
      },
      "required": [
        "file",
        "produced-by"
      ],
      "additionalProperties": false
    },
    "sources": {
      "type": "object",
      "properties": {
        "recording": {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "const": "audio"
            },
            "file": {
              "type": "string",
              "minLength": 1
            },
            "analysis": {
              "type": "object",
              "properties": {
                "file": {
                  "type": "string",
                  "minLength": 1
                },
                "produced-by": {
                  "type": "string",
                  "minLength": 1
                },
                "edited": {
                  "type": "boolean"
                }
              },
              "required": [
                "file",
                "produced-by"
              ],
              "additionalProperties": false
            },
            "startBeat": {
              "type": "number"
            },
            "beatMap": {
              "anyOf": [
                {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "anyOf": [
                      {
                        "type": "object",
                        "properties": {
                          "beat": {
                            "type": "number"
                          },
                          "t": {
                            "type": "number"
                          }
                        },
                        "required": [
                          "beat",
                          "t"
                        ],
                        "additionalProperties": false
                      },
                      {
                        "type": "object",
                        "properties": {
                          "startBeat": {
                            "type": "number"
                          },
                          "stride": {
                            "type": "integer",
                            "exclusiveMinimum": 0,
                            "maximum": 9007199254740991
                          },
                          "times": {
                            "minItems": 1,
                            "type": "array",
                            "items": {
                              "type": "number"
                            }
                          }
                        },
                        "required": [
                          "startBeat",
                          "times"
                        ],
                        "additionalProperties": false
                      }
                    ]
                  }
                },
                {
                  "type": "object",
                  "properties": {
                    "file": {
                      "type": "string",
                      "minLength": 1
                    },
                    "produced-by": {
                      "type": "string",
                      "minLength": 1
                    },
                    "edited": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "file",
                    "produced-by"
                  ],
                  "additionalProperties": false
                }
              ]
            }
          },
          "required": [
            "kind",
            "file",
            "beatMap"
          ],
          "additionalProperties": false
        },
        "stems": {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "const": "audio-group"
            },
            "curveRef": {
              "type": "string",
              "minLength": 1
            },
            "produced-by": {
              "type": "string",
              "minLength": 1
            },
            "dir": {
              "type": "string",
              "minLength": 1
            },
            "files": {
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {
                "type": "string",
                "minLength": 1
              }
            },
            "soffs": {
              "type": "number",
              "minimum": 0
            },
            "sourceEnd": {
              "type": "number",
              "exclusiveMinimum": 0
            },
            "clips": {
              "minItems": 1,
              "type": "array",
              "items": {
                "anyOf": [
                  {
                    "type": "object",
                    "properties": {
                      "from": {
                        "type": "number",
                        "minimum": 0
                      },
                      "seconds": {
                        "type": "number",
                        "exclusiveMinimum": 0
                      }
                    },
                    "required": [
                      "from",
                      "seconds"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "silence": {
                        "type": "number",
                        "exclusiveMinimum": 0
                      }
                    },
                    "required": [
                      "silence"
                    ],
                    "additionalProperties": false
                  }
                ]
              }
            }
          },
          "required": [
            "kind",
            "curveRef",
            "produced-by",
            "dir",
            "files"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "recording"
      ],
      "additionalProperties": false
    },
    "songCurve": {
      "type": "string",
      "enum": [
        "constantBpm"
      ]
    },
    "sections": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1
          },
          "bars": {
            "type": "number",
            "exclusiveMinimum": 0
          },
          "cue": {
            "type": "boolean"
          },
          "timeSignature": {
            "type": "array",
            "prefixItems": [
              {
                "type": "integer",
                "exclusiveMinimum": 0,
                "maximum": 9007199254740991
              },
              {
                "type": "integer",
                "exclusiveMinimum": 0,
                "maximum": 9007199254740991
              }
            ]
          },
          "smStride": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "smLeadSource": {
            "type": "number"
          },
          "stretchMarkers": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "item": {
                  "type": "number"
                },
                "source": {
                  "type": "number"
                }
              },
              "required": [
                "item",
                "source"
              ],
              "additionalProperties": false
            }
          },
          "click": {
            "type": "boolean"
          },
          "cues": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "at": {
                  "type": "number"
                },
                "label": {
                  "type": "string",
                  "minLength": 1
                },
                "tone": {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "bars": {
                  "type": "number",
                  "exclusiveMinimum": 0
                }
              },
              "required": [
                "at"
              ],
              "additionalProperties": false
            }
          },
          "lines": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "text": {
                  "type": "string"
                },
                "b": {
                  "type": "number"
                },
                "t": {
                  "type": "number"
                },
                "tag": {
                  "type": "string"
                }
              },
              "required": [
                "text"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "name",
          "bars"
        ],
        "additionalProperties": false
      }
    },
    "lyrics": {
      "type": "object",
      "properties": {
        "alignment": {
          "type": "object",
          "properties": {
            "file": {
              "type": "string",
              "minLength": 1
            },
            "produced-by": {
              "type": "string",
              "minLength": 1
            },
            "edited": {
              "type": "boolean"
            }
          },
          "required": [
            "file",
            "produced-by"
          ],
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    },
    "cues": {
      "type": "object",
      "properties": {
        "dir": {
          "type": "string",
          "minLength": 1
        },
        "produced-by": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "dir",
        "produced-by"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "schema",
    "title",
    "bpm",
    "timeSignature",
    "preRollBars",
    "ringOutBars",
    "sources",
    "songCurve",
    "sections",
    "lyrics"
  ],
  "additionalProperties": false
}
```
