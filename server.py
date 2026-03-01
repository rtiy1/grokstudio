import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Path as ApiPath, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, RowMapping, make_url
from sqlalchemy.exc import SQLAlchemyError


BASE_DIR = Path(__file__).resolve().parent
INDEX_FILE = BASE_DIR / "index.html"
STYLES_FILE = BASE_DIR / "styles.css"
SCRIPT_FILE = BASE_DIR / "app.js"
DEFAULT_DB_PATH = BASE_DIR / "media_studio.db"

DEFAULT_DB_URL = f"sqlite:///{DEFAULT_DB_PATH.as_posix()}"
MEDIA_DB_URL = os.getenv("MEDIA_DB_URL", DEFAULT_DB_URL)
MEDIA_DB_INIT_RETRY = int(os.getenv("MEDIA_DB_INIT_RETRY", "30"))
MEDIA_DB_INIT_INTERVAL = float(os.getenv("MEDIA_DB_INIT_INTERVAL", "2"))


def build_engine() -> Engine:
    engine_kwargs: dict[str, object] = {"pool_pre_ping": True}
    if MEDIA_DB_URL.startswith("sqlite"):
        engine_kwargs["connect_args"] = {"check_same_thread": False}
    else:
        engine_kwargs["pool_recycle"] = 1800
    return create_engine(MEDIA_DB_URL, **engine_kwargs)


engine: Engine = build_engine()


def utc_now_datetime() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def normalize_datetime(value: str | None) -> datetime:
    text_value = (value or "").strip()
    if not text_value:
        return utc_now_datetime()

    normalized = text_value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return utc_now_datetime()

    if parsed.tzinfo is None:
        return parsed
    return parsed.astimezone(timezone.utc).replace(tzinfo=None)


def datetime_to_iso(value: datetime | str | None) -> str:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            utc_value = value.replace(tzinfo=timezone.utc)
        else:
            utc_value = value.astimezone(timezone.utc)
        return utc_value.isoformat().replace("+00:00", "Z")
    if isinstance(value, str):
        normalized = value.strip().replace("Z", "+00:00")
        if not normalized:
            return utc_now_datetime().replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError:
            return value
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        else:
            parsed = parsed.astimezone(timezone.utc)
        return parsed.isoformat().replace("+00:00", "Z")
    return utc_now_datetime().replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def database_info() -> dict:
    try:
        parsed = make_url(MEDIA_DB_URL)
        return {
            "driver": parsed.drivername,
            "host": parsed.host or "",
            "port": parsed.port,
            "database": parsed.database or "",
        }
    except Exception:
        return {"driver": "unknown", "host": "", "port": None, "database": ""}


def initialize_database() -> None:
    create_table_sql = """
    CREATE TABLE IF NOT EXISTS media_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        media_type TEXT NOT NULL,
        task_type TEXT NULL,
        model TEXT NULL,
        prompt TEXT NULL,
        source_url TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    """
    create_index_sql = """
    CREATE INDEX IF NOT EXISTS idx_media_assets_type_created
    ON media_assets (media_type, created_at, id);
    """

    last_error: Exception | None = None
    for attempt in range(1, MEDIA_DB_INIT_RETRY + 1):
        try:
            with engine.begin() as connection:
                connection.execute(text(create_table_sql))
                connection.execute(text(create_index_sql))
            return
        except SQLAlchemyError as error:
            last_error = error
            if attempt >= MEDIA_DB_INIT_RETRY:
                break
            time.sleep(MEDIA_DB_INIT_INTERVAL)

    raise RuntimeError("数据库初始化失败，请检查 SQLite 配置与连通性") from last_error


class MediaCreate(BaseModel):
    media_type: Literal["image", "video"] = "image"
    task_type: str | None = Field(default=None, max_length=64)
    model: str | None = Field(default=None, max_length=128)
    prompt: str | None = None
    source_url: str = Field(min_length=1, max_length=65535)
    created_at: str | None = None


class MediaBatchCreate(BaseModel):
    items: list[MediaCreate] = Field(min_length=1, max_length=50)


class MediaItem(BaseModel):
    id: int
    media_type: Literal["image", "video"]
    task_type: str | None = None
    model: str | None = None
    prompt: str | None = None
    source_url: str
    created_at: str


class MediaListResponse(BaseModel):
    items: list[MediaItem]
    total: int


def row_to_item(row: RowMapping) -> MediaItem:
    return MediaItem(
        id=int(row["id"]),
        media_type=row["media_type"],
        task_type=row["task_type"],
        model=row["model"],
        prompt=row["prompt"],
        source_url=row["source_url"],
        created_at=datetime_to_iso(row.get("created_at")),
    )


def insert_media_record(payload: MediaCreate) -> MediaItem:
    media_type = payload.media_type
    task_type = (payload.task_type or "").strip() or None
    model = (payload.model or "").strip() or None
    prompt = (payload.prompt or "").strip() or None
    source_url = payload.source_url.strip()
    created_at = normalize_datetime(payload.created_at)

    if not source_url:
        raise HTTPException(status_code=400, detail="source_url 不能为空")

    try:
        with engine.begin() as connection:
            insert_result = connection.execute(
                text(
                    """
                    INSERT INTO media_assets (
                        media_type, task_type, model, prompt, source_url, created_at
                    )
                    VALUES (
                        :media_type, :task_type, :model, :prompt, :source_url, :created_at
                    )
                    """
                ),
                {
                    "media_type": media_type,
                    "task_type": task_type,
                    "model": model,
                    "prompt": prompt,
                    "source_url": source_url,
                    "created_at": created_at,
                },
            )

            media_id = int(
                insert_result.lastrowid
                or (insert_result.inserted_primary_key[0] if insert_result.inserted_primary_key else 0)
            )
            if media_id <= 0:
                raise HTTPException(status_code=500, detail="记录写入成功但主键读取失败")

            row = connection.execute(
                text(
                    """
                    SELECT id, media_type, task_type, model, prompt, source_url, created_at
                    FROM media_assets
                    WHERE id = :id
                    """
                ),
                {"id": media_id},
            ).mappings().first()

            if row is None:
                raise HTTPException(status_code=500, detail="记录写入成功但读取失败")
            return row_to_item(row)
    except HTTPException:
        raise
    except SQLAlchemyError as error:
        raise HTTPException(status_code=500, detail="数据库写入失败") from error


app = FastAPI(title="Grok Media Studio", version="1.1.0")


@app.on_event("startup")
def on_startup() -> None:
    initialize_database()


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(INDEX_FILE)


@app.get("/styles.css", include_in_schema=False)
def styles() -> FileResponse:
    return FileResponse(STYLES_FILE)


@app.get("/app.js", include_in_schema=False)
def script() -> FileResponse:
    return FileResponse(SCRIPT_FILE)


@app.get("/api/health")
def health_check() -> dict:
    return {"status": "ok", "database": database_info()}


@app.get("/api/media", response_model=MediaListResponse)
def list_media(
    media_type: Literal["image", "video", "all"] = Query(default="image"),
    limit: int = Query(default=100, ge=1, le=500),
) -> MediaListResponse:
    if media_type == "all":
        sql = """
            SELECT id, media_type, task_type, model, prompt, source_url, created_at
            FROM media_assets
            ORDER BY id DESC
            LIMIT :limit
        """
        params: dict[str, int | str] = {"limit": limit}
    else:
        sql = """
            SELECT id, media_type, task_type, model, prompt, source_url, created_at
            FROM media_assets
            WHERE media_type = :media_type
            ORDER BY id DESC
            LIMIT :limit
        """
        params = {"media_type": media_type, "limit": limit}

    try:
        with engine.begin() as connection:
            rows = connection.execute(text(sql), params).mappings().all()
    except SQLAlchemyError as error:
        raise HTTPException(status_code=500, detail="数据库查询失败") from error

    items = [row_to_item(row) for row in rows]
    return MediaListResponse(items=items, total=len(items))


@app.post("/api/media", response_model=MediaItem)
def create_media(payload: MediaCreate) -> MediaItem:
    return insert_media_record(payload)


@app.post("/api/media/batch")
def create_media_batch(payload: MediaBatchCreate) -> dict:
    saved_items = [insert_media_record(item) for item in payload.items]
    return {"saved": len(saved_items)}


@app.delete("/api/media/{media_id}")
def delete_media(media_id: int = ApiPath(..., gt=0)) -> dict:
    try:
        with engine.begin() as connection:
            result = connection.execute(
                text("DELETE FROM media_assets WHERE id = :id"),
                {"id": media_id},
            )
            if result.rowcount == 0:
                raise HTTPException(status_code=404, detail=f"记录 #{media_id} 不存在")
    except HTTPException:
        raise
    except SQLAlchemyError as error:
        raise HTTPException(status_code=500, detail="数据库删除失败") from error

    return {"deleted": 1, "id": media_id}
