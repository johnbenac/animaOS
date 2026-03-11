from fastapi import FastAPI

from .config import settings


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name)

    @app.get("/health", tags=["system"])
    async def health() -> dict[str, str]:
        return {
            "status": "ok",
            "service": "server",
            "environment": settings.app_env,
        }

    return app


app = create_app()
