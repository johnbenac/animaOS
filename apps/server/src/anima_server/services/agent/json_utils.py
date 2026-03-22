"""Centralised JSON extraction from LLM response text.

Uses ``json_repair`` to handle the messy outputs local models tend to
produce (markdown fences, trailing commas, truncated responses, etc.).
"""

from __future__ import annotations

import json
from typing import Any

from json_repair import repair_json


def parse_json_object(text: str) -> dict[str, Any] | None:
    """Extract a JSON object from *text*, repairing if needed.

    Returns ``None`` when no object can be recovered.
    """
    text = _strip_fences(text).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    candidate = text[start : end + 1]
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        try:
            parsed = repair_json(candidate, return_objects=True)
        except Exception:
            return None
    if not isinstance(parsed, dict):
        return None
    return parsed


def parse_json_array(text: str) -> list[Any]:
    """Extract a JSON array from *text*, repairing if needed.

    Returns an empty list when no array can be recovered.
    """
    text = _strip_fences(text).strip()
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return []
    candidate = text[start : end + 1]
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        try:
            parsed = repair_json(candidate, return_objects=True)
        except Exception:
            return []
    if not isinstance(parsed, list):
        return []
    return parsed


# ── private helpers ──────────────────────────────────────────────────


def _strip_fences(text: str) -> str:
    """Remove markdown code fences wrapping the text."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines)
    return text
