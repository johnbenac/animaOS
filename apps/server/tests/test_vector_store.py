from __future__ import annotations

import gc
from pathlib import Path
from unittest.mock import patch

import pytest

import anima_server.services.agent.vector_store as vs
from anima_server.services.agent.vector_store import (
    delete_memory,
    get_collection,
    rebuild_user_index,
    search_similar,
    upsert_memory,
)


@pytest.fixture(autouse=True)
def _isolate_chroma(managed_tmp_path: Path):
    """Give each test a fresh vector store and isolated data dir."""
    vs._client = None
    vs._legacy_cleanup_done = False
    with patch.object(vs, "settings") as mock_settings:
        mock_settings.data_dir = managed_tmp_path
        yield
    # Fully release the client before temp-dir cleanup.
    if vs._client is not None:
        try:
            vs._client.clear_system_cache()
        except Exception:
            pass
    vs._client = None
    gc.collect()


def test_upsert_and_search() -> None:
    user_id = 1
    upsert_memory(
        user_id,
        item_id=1,
        content="I love hiking in mountains",
        embedding=[1.0, 0.0, 0.0],
        category="preference",
        importance=4,
    )
    upsert_memory(
        user_id,
        item_id=2,
        content="Works as a software engineer",
        embedding=[0.0, 1.0, 0.0],
        category="fact",
        importance=5,
    )

    results = search_similar(
        user_id,
        query_embedding=[0.9, 0.1, 0.0],
        limit=5,
    )

    assert len(results) == 2
    assert results[0]["id"] == 1
    assert results[0]["similarity"] > 0.9

    # Category filter
    results_filtered = search_similar(
        user_id,
        query_embedding=[0.9, 0.1, 0.0],
        limit=5,
        category="fact",
    )
    assert len(results_filtered) == 1
    assert results_filtered[0]["id"] == 2


def test_delete_memory() -> None:
    user_id = 2
    upsert_memory(
        user_id,
        item_id=10,
        content="test item",
        embedding=[1.0, 0.0],
        category="fact",
        importance=3,
    )
    collection = get_collection(user_id)
    assert collection.count() == 1

    delete_memory(user_id, item_id=10)
    assert collection.count() == 0


def test_rebuild_user_index() -> None:
    user_id = 3
    items = [
        (1, "fact one", [1.0, 0.0, 0.0], "fact", 3),
        (2, "fact two", [0.0, 1.0, 0.0], "fact", 4),
        (3, "pref one", [0.0, 0.0, 1.0], "preference", 5),
    ]
    count = rebuild_user_index(user_id, items)
    assert count == 3

    collection = get_collection(user_id)
    assert collection.count() == 3

    # Rebuild with fewer items replaces the old index
    count = rebuild_user_index(user_id, items[:1])
    assert count == 1
    collection = get_collection(user_id)  # re-fetch after rebuild
    assert collection.count() == 1


def test_empty_collection_search() -> None:
    results = search_similar(
        user_id=99,
        query_embedding=[1.0, 0.0],
        limit=5,
    )
    assert results == []


def test_legacy_persist_dir_is_removed_on_init(managed_tmp_path: Path) -> None:
    legacy_dir = managed_tmp_path / "chroma"
    legacy_dir.mkdir(parents=True, exist_ok=True)
    (legacy_dir / "old-index.txt").write_text("legacy plaintext", encoding="utf-8")

    get_collection(user_id=7)

    assert not legacy_dir.exists()
