[简体中文](README.md) | [English](README_EN.md)

# Grok Media Studio

[![FastAPI](https://img.shields.io/badge/FastAPI-0.109.0+-009688.svg?style=flat&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57.svg?style=flat&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Docker](https://img.shields.io/badge/Docker-Supported-2496ED.svg?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)

A full-featured, standalone media generation studio integrating Grok-style multimedia generation capabilities with a localized asset management system.

## 🌟 Core Features

- **🚀 Multi-mode Generation**:
  - **Text-to-Image (T2I)**: Generate stunning images from prompts with multiple size options.
  - **Image-to-Image (I2I)**: Edit and redraw images by uploading a reference photo along with a prompt.
  - **Image-to-Video (I2V)**: Transform static images and prompts into dynamic video content with custom resolution and duration.
- **📦 Asset Management**:
  - **Automatic Persistence**: All generated image results are automatically saved to the SQLite database.
  - **Visual Gallery**: An intuitive assets interface to browse your generation history.
  - **Flexible Actions**: Preview and permanently delete individual asset records.
- **⚙️ Configurable Options**:
  - Custom API URLs and API Keys to fit various backend providers.
  - Built-in connection testing to ensure your settings are working instantly.

## 🛠️ Tech Stack

- **Frontend**: Native HTML5, CSS3 (Vanilla CSS), JavaScript (ES6+)
- **Backend**: [FastAPI](https://fastapi.tiangolo.com/) (Python 3.10+)
- **Database**: [SQLite 3](https://www.sqlite.org/)
- **ORM**: [SQLAlchemy](https://www.sqlalchemy.org/) (built-in SQLite driver)
- **Deployment**: Docker & Docker Compose

## 🚀 Quick Start

### Method 1: One-Click Docker Deployment (Recommended)

Run the following in the project root directory (containing `docker-compose.yml`):

```bash
docker compose up -d --build
```

Access details:
- **Frontend**: [http://localhost:8088](http://localhost:8088)
- **SQLite DB file**: `/app/data/media_studio.db` (inside container)

> [!NOTE]
> Database configurations are defined in `docker-compose.yml`. The volume `media_studio_sqlite_data` ensures your data remains safe even if the containers are removed.

### Method 2: Local Development

1. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```
2. **Set Environment Variable (Optional)**:
   - Windows (PowerShell): `$env:MEDIA_DB_URL="sqlite:///./media_studio.db"`
   - Linux/macOS: `export MEDIA_DB_URL="sqlite:///./media_studio.db"`
3. **Start Service**:
   ```bash
   uvicorn server:app --host 0.0.0.0 --port 8088 --reload
   ```

## 🔌 API Documentation

Built-in RESTful endpoints for easy integration:

- `GET /api/health`: Check service status and database connection.
- `GET /api/media`: List assets (supports filtering by `image`, `video`, `all`).
- `POST /api/media`: Insert a single media record.
- `POST /api/media/batch`: Batch insert media records.
- `DELETE /api/media/{id}`: Delete a specific asset.

## 📁 SQLite Configuration

Update `MEDIA_DB_URL` to customize database file location:
`sqlite:///./media_studio.db` (relative path)
`sqlite:////absolute/path/media_studio.db` (absolute path)

---

## 📄 License

This project is licensed under the MIT License. Feel free to use and contribute!
