from __future__ import annotations

import shutil
from collections.abc import Generator
from pathlib import Path
from uuid import uuid4

import pytest

from anima_server.services.agent.vector_store import reset_vector_store

TEST_TEMP_ROOT = Path(__file__).resolve().parents[3] / ".tmp-tests"


def create_managed_temp_dir(prefix: str) -> Path:
    TEST_TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    temp_root = TEST_TEMP_ROOT / f"{prefix}{uuid4().hex}"
    temp_root.mkdir(parents=True, exist_ok=False)
    return temp_root


@pytest.fixture()
def managed_tmp_path() -> Generator[Path, None, None]:
    temp_root = create_managed_temp_dir("anima-test-")
    reset_vector_store()
    try:
        yield temp_root
    finally:
        reset_vector_store()
        shutil.rmtree(temp_root, ignore_errors=True)
