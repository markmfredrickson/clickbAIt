"""CLI wrapper for batch song lookup — called by Claude Code skill."""

import json
import sys

from dotenv import load_dotenv

load_dotenv()

from clickbait.sources.lookup import lookup_song, format_lookup_results


def main():
    if len(sys.argv) < 2:
        print("Usage: python -m clickbait.lookup_cli <title> [artist]", file=sys.stderr)
        sys.exit(1)

    title = sys.argv[1]
    artist = sys.argv[2] if len(sys.argv) > 2 else None

    results = lookup_song(title, artist)
    print(format_lookup_results(results))


if __name__ == "__main__":
    main()
