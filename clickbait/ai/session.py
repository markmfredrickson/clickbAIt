"""Interactive AI session for designing song projects."""

from anthropic import Anthropic
from prompt_toolkit import PromptSession
from rich.console import Console
from rich.markdown import Markdown

from clickbait.ai.prompts import load_system_prompt
from clickbait.ai.tools import TOOLS
from clickbait.models import Section, Song
from clickbait.sources import genius

console = Console()


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
        return str(result)

    return f"Unknown tool: {name}"


def run_session():
    """Run the interactive chat session."""
    client = Anthropic()
    prompt_session = PromptSession()
    messages = []
    song = Song(title="Untitled")
    system_prompt = load_system_prompt()

    console.print("[bold]clickbAIt[/bold] — AI song project builder")
    console.print("Type a song name or describe what you want to build. Ctrl-D to exit.\n")

    while True:
        try:
            user_input = prompt_session.prompt("you> ")
        except (EOFError, KeyboardInterrupt):
            console.print("\nBye!")
            break

        if not user_input.strip():
            continue

        messages.append({"role": "user", "content": user_input})

        # Claude may make multiple tool calls in a loop before giving a text response
        while True:
            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=4096,
                system=system_prompt,
                tools=TOOLS,
                messages=messages,
            )

            # Process response content
            assistant_content = response.content
            messages.append({"role": "assistant", "content": assistant_content})

            # Handle tool use blocks
            tool_results = []
            for block in assistant_content:
                if block.type == "text" and block.text:
                    console.print(Markdown(block.text))
                elif block.type == "tool_use":
                    result = handle_tool_call(song, block.name, block.input)
                    console.print(f"  [dim]→ {result}[/dim]")
                    tool_results.append(
                        {"type": "tool_result", "tool_use_id": block.id, "content": result}
                    )

            # If there were tool calls, send results back and let Claude continue
            if tool_results:
                messages.append({"role": "user", "content": tool_results})
                continue

            # No tool calls — Claude gave a final text response, back to user
            break
