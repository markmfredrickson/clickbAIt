"""Interactive AI session for designing song projects."""

import json
from dataclasses import dataclass, field

from anthropic import Anthropic
from prompt_toolkit import PromptSession
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.spinner import Spinner

from clickbait.ai.prompts import load_system_prompt
from clickbait.ai.tools import TOOLS
from clickbait.models import Section, Song
from clickbait.sources import deezer, genius, musicbrainz

console = Console()

MUSIC_SPINNER = Spinner("dots", text="", style="dim")
MUSIC_SPINNER.frames = ["♩ ", "♪ ", "♫ ", "♬ "]


def _format_lyrics_result(result: dict) -> str:
    """Format a Genius lyrics result as readable text for Claude."""
    lines = [f"Title: {result['title']}", f"Artist: {result['artist']}", "", "Lyrics by section:"]
    for section in result["sections"]:
        lines.append(f"\n[{section['name']}]")
        lines.append(section["lyrics"])
    return "\n".join(lines)


def handle_tool_call(song: Song, name: str, args: dict) -> str:
    """Execute a tool call and return a result message."""
    if name == "set_song_metadata":
        song.title = args.get("title", song.title)
        song.artist = args.get("artist", song.artist)
        song.bpm = args.get("bpm", song.bpm)
        song.key = args.get("key", song.key)
        if "time_signature" in args:
            song.time_signature = tuple(args["time_signature"])
        return f"Updated metadata: {song.title} by {song.artist}, {song.bpm} BPM, {song.key}"

    if name == "set_song_structure":
        song.sections = [Section(name=s["name"], measures=s["measures"]) for s in args["sections"]]
        names = [song.numbered_section_name(i) for i in range(len(song.sections))]
        return f"Set structure: {', '.join(names)}"

    if name == "set_section_lyrics":
        idx = args["section_index"]
        if 0 <= idx < len(song.sections):
            song.sections[idx].lyrics = args["lyrics"]
            return f"Set lyrics for section {idx} ({song.numbered_section_name(idx)})"
        return f"Error: section index {idx} out of range"

    if name == "lookup_lyrics":
        result = genius.search_lyrics(args["title"], args.get("artist"))
        if result is None:
            return "No lyrics found on Genius."
        if "error" in result:
            return result["error"]
        return _format_lyrics_result(result)

    if name == "lookup_bpm":
        result = deezer.search_track(args["title"], args.get("artist"))
        if result is None:
            return "No results found on Deezer."
        if "error" in result:
            return result["error"]
        return str(result)

    if name == "lookup_song_info":
        result = musicbrainz.search_recording(args["title"], args.get("artist"))
        if result is None:
            return "No results found on MusicBrainz."
        return str(result)

    return f"Unknown tool: {name}"


@dataclass
class ChatSession:
    """Manages conversation state and Claude API interaction."""

    client: Anthropic
    song: Song = field(default_factory=lambda: Song(title="Untitled"))
    messages: list = field(default_factory=list)
    system_prompt: str = ""
    verbose: bool = False
    model: str = "claude-sonnet-4-20250514"

    def process_turn(self, user_input: str) -> list[dict]:
        """Process one user turn. Returns list of {type, content} output blocks.

        Output block types:
        - {"type": "text", "content": "..."} — text to display
        - {"type": "tool_call", "name": "...", "input": {...}, "result": "..."} — tool call info
        """
        self.messages.append({"role": "user", "content": user_input})
        outputs = []

        while True:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=4096,
                system=self.system_prompt,
                tools=TOOLS,
                messages=self.messages,
            )

            assistant_content = response.content
            self.messages.append({"role": "assistant", "content": assistant_content})

            tool_results = []
            for block in assistant_content:
                if block.type == "text" and block.text:
                    outputs.append({"type": "text", "content": block.text})
                elif block.type == "tool_use":
                    result = handle_tool_call(self.song, block.name, block.input)
                    outputs.append({
                        "type": "tool_call",
                        "name": block.name,
                        "input": block.input,
                        "result": result,
                    })
                    tool_results.append(
                        {"type": "tool_result", "tool_use_id": block.id, "content": result}
                    )

            if tool_results:
                self.messages.append({"role": "user", "content": tool_results})
                continue

            break

        return outputs

    def handle_command(self, cmd: str) -> str | None:
        """Handle a slash command. Returns output text, or None for unknown."""
        cmd = cmd.strip().lower()
        if cmd == "/verbose":
            self.verbose = not self.verbose
            return f"Verbose mode {'on' if self.verbose else 'off'}"
        if cmd == "/song":
            lines = [
                f"  Title: {self.song.title}",
                f"  Artist: {self.song.artist}",
                f"  BPM: {self.song.bpm}",
                f"  Key: {self.song.key}",
                f"  Time Sig: {self.song.time_signature[0]}/{self.song.time_signature[1]}",
                f"  Sections: {len(self.song.sections)}",
            ]
            for i, s in enumerate(self.song.sections):
                has_lyrics = " [lyrics]" if s.lyrics else ""
                lines.append(f"    {self.song.numbered_section_name(i)}: {s.measures} measures{has_lyrics}")
            return "\n".join(lines)
        if cmd == "/help":
            return "  /verbose  — toggle verbose mode (show tool calls)\n  /song     — show current song state\n  /help     — show this help"
        return None


def run_session(verbose: bool = False):
    """Run the interactive chat session."""
    session = ChatSession(
        client=Anthropic(),
        system_prompt=load_system_prompt(),
        verbose=verbose,
    )
    prompt_session = PromptSession()

    console.print("[bold]clickbAIt[/bold] — AI song project builder")
    console.print("Type a song name or describe what you want to build. Ctrl-D to exit.\n")

    while True:
        try:
            user_input = prompt_session.prompt("> ")
        except (EOFError, KeyboardInterrupt):
            console.print("\nBye!")
            break

        if not user_input.strip():
            continue

        if user_input.strip().lower() in ("exit", "quit", "q"):
            console.print("Bye!")
            break

        if user_input.startswith("/"):
            result = session.handle_command(user_input)
            if result is not None:
                console.print(result)
            else:
                console.print(f"  Unknown command: {user_input.strip()}. Type /help for commands.")
            continue

        with console.status(MUSIC_SPINNER):
            outputs = session.process_turn(user_input)

        # Collect text blocks and show tool calls if verbose
        text_parts = []
        for output in outputs:
            if output["type"] == "text":
                text_parts.append(output["content"])
            elif output["type"] == "tool_call":
                if session.verbose:
                    console.print(f"  [dim]tool: {output['name']}({json.dumps(output['input'])})[/dim]")
                    console.print(f"  [dim]→ {output['result']}[/dim]")

        # Render all text as one markdown block in a panel
        if text_parts:
            combined = "\n\n".join(text_parts)
            console.print(Panel(Markdown(combined), border_style="dim", padding=(1, 2)))
