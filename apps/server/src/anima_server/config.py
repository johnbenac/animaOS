from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "ANIMA Server"
    app_env: str = "development"
    host: str = "127.0.0.1"
    port: int = 3031

    model_config = SettingsConfigDict(
        env_prefix="ANIMA_",
        env_file=".env",
        extra="ignore",
    )


settings = Settings()
