from __future__ import annotations

import logging
from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from anima_server.config import settings
from anima_server.db.url import ensure_database_directory

logger = logging.getLogger(__name__)

ensure_database_directory(settings.database_url)


def _make_engine() -> Engine:
    url = settings.database_url

    if not url.startswith("sqlite"):
        return create_engine(
            url,
            echo=settings.database_echo,
            future=True,
            pool_pre_ping=True,
        )

    passphrase = settings.core_passphrase.strip()
    require_encryption = settings.core_require_encryption

    if require_encryption and not passphrase:
        raise RuntimeError(
            "ANIMA_CORE_REQUIRE_ENCRYPTION is enabled but ANIMA_CORE_PASSPHRASE is not set. "
            "Provide a passphrase or disable encryption enforcement."
        )

    if passphrase:
        try:
            import sqlcipher3
        except ImportError:
            if require_encryption:
                raise RuntimeError(
                    "ANIMA_CORE_REQUIRE_ENCRYPTION is enabled but sqlcipher3 is not installed. "
                    "Install sqlcipher3 to enable database encryption: pip install sqlcipher3"
                )
            logger.warning(
                "sqlcipher3 not installed — falling back to unencrypted SQLite. "
                "Install sqlcipher3 to enable database encryption."
            )
            return create_engine(
                url,
                echo=settings.database_echo,
                future=True,
                connect_args={"check_same_thread": False},
            )

        eng = create_engine(
            url,
            echo=settings.database_echo,
            future=True,
            module=sqlcipher3,
            connect_args={"check_same_thread": False},
        )

        @event.listens_for(eng, "connect")
        # type: ignore[no-untyped-def]
        def _set_sqlcipher_key(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            escaped = passphrase.replace("'", "''")
            cursor.execute(f"PRAGMA key = '{escaped}'")
            cursor.close()

        logger.info("Database encryption enabled (SQLCipher).")
        return eng

    if require_encryption:
        # Should not reach here — caught above — but guard anyway
        raise RuntimeError("Encryption required but no passphrase provided.")

    logger.info("Database encryption not configured — using plain SQLite.")
    return create_engine(
        url,
        echo=settings.database_echo,
        future=True,
        connect_args={"check_same_thread": False},
    )


engine = _make_engine()

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    class_=Session,
)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
