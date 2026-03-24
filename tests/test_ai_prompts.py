"""Tests for AI prompt loading."""

from pathlib import Path

from clickbait.ai.prompts import load_system_prompt, DEFAULT_SYSTEM_PROMPT


def test_default_prompt_when_no_file():
    result = load_system_prompt()
    assert result == DEFAULT_SYSTEM_PROMPT


def test_custom_prompt_from_file(tmp_path, monkeypatch):
    custom = "You are a custom assistant."
    prompt_file = tmp_path / ".clickbait" / "SYSTEM.md"
    prompt_file.parent.mkdir()
    prompt_file.write_text(custom)
    monkeypatch.setattr("clickbait.ai.prompts.SYSTEM_PROMPT_PATH", prompt_file)
    result = load_system_prompt()
    assert result == custom


def test_custom_prompt_strips_whitespace(tmp_path, monkeypatch):
    prompt_file = tmp_path / ".clickbait" / "SYSTEM.md"
    prompt_file.parent.mkdir()
    prompt_file.write_text("  Custom prompt with spaces  \n\n")
    monkeypatch.setattr("clickbait.ai.prompts.SYSTEM_PROMPT_PATH", prompt_file)
    result = load_system_prompt()
    assert result == "Custom prompt with spaces"


def test_default_prompt_contains_key_instructions():
    assert "music production assistant" in DEFAULT_SYSTEM_PROMPT
    assert "set_section_lyrics" in DEFAULT_SYSTEM_PROMPT
    assert "LYRICS POLICY" in DEFAULT_SYSTEM_PROMPT
