"""CLI entry point for clickbAIt."""

from dotenv import load_dotenv
import typer

load_dotenv()

app = typer.Typer(help="clickbAIt: AI-powered click, cue, and backing track tools")


@app.command()
def chat():
    """Start an interactive AI session to design a song project."""
    from clickbait.ai.session import run_session

    run_session()


@app.command()
def generate(project_path: str = typer.Argument(help="Path to write the .RPP file")):
    """Generate a REAPER project from a song definition."""
    typer.echo(f"Generate not yet implemented. Target: {project_path}")


if __name__ == "__main__":
    app()
