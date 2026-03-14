from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


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
    userId: int = Field(gt=0)
    text: str = Field(min_length=1)
    priority: int = Field(default=2, ge=1, le=5)
    dueDate: str | None = None


class TaskUpdateRequest(BaseModel):
    text: str | None = None
    done: bool | None = None
    priority: int | None = Field(default=None, ge=1, le=5)
    dueDate: str | None = None
