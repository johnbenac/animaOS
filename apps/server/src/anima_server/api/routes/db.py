from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from anima_server.api.deps.unlock import require_unlocked_session
from anima_server.db import get_db

router = APIRouter(prefix="/api/db", tags=["db"])

MAX_ROWS = 500


@router.get("/tables")
def list_tables(
    request: Request,
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    require_unlocked_session(request)
    insp = inspect(db.get_bind())
    tables = []
    for name in sorted(insp.get_table_names()):
        row_count = db.execute(text(f'SELECT COUNT(*) FROM "{name}"')).scalar()
        tables.append({"name": name, "rowCount": row_count or 0})
    return tables


@router.get("/tables/{table_name}")
def get_table_rows(
    table_name: str,
    request: Request,
    db: Session = Depends(get_db),
    limit: int = Query(default=100, ge=1, le=MAX_ROWS),
    offset: int = Query(default=0, ge=0),
) -> dict[str, object]:
    require_unlocked_session(request)
    insp = inspect(db.get_bind())
    all_tables = insp.get_table_names()
    if table_name not in all_tables:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=404, detail=f"Table '{table_name}' not found")

    columns = [col["name"] for col in insp.get_columns(table_name)]
    total = db.execute(
        text(f'SELECT COUNT(*) FROM "{table_name}"')).scalar() or 0
    rows_raw = db.execute(
        text(f'SELECT * FROM "{table_name}" LIMIT :lim OFFSET :off'),
        {"lim": limit, "off": offset},
    ).fetchall()
    rows = [dict(zip(columns, row)) for row in rows_raw]
    return {"table": table_name, "columns": columns, "rows": rows, "total": total}


@router.post("/query")
def run_query(
    request: Request,
    body: dict[str, str],
    db: Session = Depends(get_db),
) -> dict[str, object]:
    require_unlocked_session(request)
    sql = (body.get("sql") or "").strip()
    if not sql:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Empty query")

    # Only allow SELECT statements for safety
    first_word = sql.split()[0].upper() if sql.split() else ""
    if first_word not in ("SELECT", "PRAGMA", "EXPLAIN"):
        from fastapi import HTTPException
        raise HTTPException(
            status_code=400, detail="Only SELECT, PRAGMA, and EXPLAIN queries are allowed")

    result = db.execute(text(sql))
    columns = list(result.keys()) if result.returns_rows else []
    rows = [dict(zip(columns, row))
            for row in result.fetchall()] if result.returns_rows else []
    return {"columns": columns, "rows": rows, "rowCount": len(rows)}
