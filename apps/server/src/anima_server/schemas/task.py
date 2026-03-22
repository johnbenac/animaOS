from __future__ import annotations

import re
from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

_DUE_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def normalize_task_text(value: str) -> str:
    stripped = value.strip()
    if not stripped:
        raise ValueError("Task text cannot be empty.")
    return stripped


def normalize_due_date(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    if _DUE_DATE_RE.fullmatch(stripped) is None:
        raise ValueError("dueDate must use YYYY-MM-DD format.")
    try:
        date.fromisoformat(stripped)
    except ValueError as exc:
        raise ValueError("dueDate must be a valid calendar date.") from exc
    return stripped


class TaskResponse(BaseModel):
    id: int
    userId: int
    text: str
    done: bool
    priority: int
    dueDate: str | None = None
    completedAt: datetime | None = None
    createdAt: datetime | None = None
    updatedAt: datetime | None = None


class TaskCreateRequest(BaseModel):
    userId: int = Field(ge=0)
    text: str = Field(min_length=1)
    priority: int = Field(default=2, ge=1, le=5)
    dueDate: str | None = None

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        return normalize_task_text(value)

    @field_validator("dueDate")
    @classmethod
    def validate_due_date(cls, value: str | None) -> str | None:
        return normalize_due_date(value)


class TaskUpdateRequest(BaseModel):
    text: str | None = None
    done: bool | None = None
    priority: int | None = Field(default=None, ge=1, le=5)
    dueDate: str | None = None

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return normalize_task_text(value)

    @field_validator("dueDate")
    @classmethod
    def validate_due_date(cls, value: str | None) -> str | None:
        return normalize_due_date(value)
