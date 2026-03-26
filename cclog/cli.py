"""CLI entrypoint for cclog."""

import webbrowser
from pathlib import Path

import click


def check_for_update():
    """Check PyPI for a newer version, print a notice if available."""
    try:
        from urllib.request import urlopen
        import json
        from . import __version__

        resp = urlopen("https://pypi.org/pypi/claude-log/json", timeout=3)
        data = json.loads(resp.read())
        latest = data["info"]["version"]

        if latest != __version__:
            click.secho(
                f"  Update available: {__version__} → {latest}  "
                f"Run: pip install --upgrade claude-log",
                fg="yellow",
            )
    except Exception:
        pass  # network error, no PyPI, etc — silently skip


@click.command()
@click.option("--port", "-p", default=9117, help="Port to serve the web UI on")
@click.option("--claude-home", type=click.Path(exists=True), help="Path to Claude home directory")
@click.option("--no-open", is_flag=True, help="Don't open browser automatically")
@click.option("--host", default="127.0.0.1", help="Host to bind to")
@click.option("--update", is_flag=True, help="Update claude-log to the latest version")
def main(port: int, claude_home: str | None, no_open: bool, host: str, update: bool):
    """Browse, search, and analyze your Claude Code conversation history."""
    import subprocess
    import sys
    from . import __version__

    if update:
        click.echo("Updating claude-log...")
        subprocess.run([sys.executable, "-m", "pip", "install", "--upgrade", "claude-log"])
        return

    import uvicorn
    from .app import create_app

    click.echo(f"cclog v{__version__}")
    check_for_update()

    home = Path(claude_home) if claude_home else None
    app = create_app(claude_home=home)

    if not no_open:
        webbrowser.open(f"http://localhost:{port}")

    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
