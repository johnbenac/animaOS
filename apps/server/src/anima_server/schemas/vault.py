from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class VaultExportRequest(BaseModel):
    passphrase: str = Field(min_length=8)
    scope: Literal["full", "memories"] = "full"


class VaultImportRequest(BaseModel):
    passphrase: str = Field(min_length=8)
    vault: str = Field(min_length=1)


class VaultExportResponse(BaseModel):
    filename: str
    vault: str
    size: int


class VaultImportResponse(BaseModel):
    status: str
    restoredUsers: int
    restoredMemoryFiles: int
    requiresReauth: bool = True
