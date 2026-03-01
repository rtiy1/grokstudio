[简体中文](README.md) | [English](README_EN.md)

# Grok 媒体工具站 (Grok Media Studio)

[![FastAPI](https://img.shields.io/badge/FastAPI-0.109.0+-009688.svg?style=flat&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Docker](https://img.shields.io/badge/Docker-Supported-2496ED.svg?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)

这是一个功能齐全、可独立部署的媒体生成工具站，集成了 Grok 风格的多媒体生成能力与本地化作品管理系统。

## 🌟 核心功能

- **🚀 多模式生成**：
  - **文生图 (T2I)**：支持多种尺寸选择，基于提示词生成精美图像。
  - **图生图 (I2I)**：通过上传参考图并配合提示词，进行图像编辑与重绘。
  - **图转视频 (I2V)**：结合图片与提示词，生成动态视频内容，支持自定义分辨率与时长。
- **📦 作品库管理**：
  - **自动持久化**：所有生成的图像结果自动保存至 SQLite 数据库。
  - **可视化浏览**：提供直观的作品库界面，支持历史记录的查看。
  - **灵活操作**：支持对单条作品记录进行预览和永久删除。
- **⚙️ 灵活配置**：
  - 支持自定义 API 路径与 API Key，完美适配多种后端接口。
  - 提供连接测试功能，确保配置即刻可用。

## 🛠️ 技术栈

- **前端**：原生 HTML5, CSS3 (Vanilla CSS), JavaScript (ES6+)
- **后端**：[FastAPI](https://fastapi.tiangolo.com/) (Python 3.10+)
- **数据库**：[SQLite 3](https://www.sqlite.org/)
- **ORM**：[SQLAlchemy](https://www.sqlalchemy.org/)（内置 SQLite 驱动）
- **部署**：Docker & Docker Compose

## 🚀 快速开始

### 方式一：Docker 一键部署（推荐）

在项目根目录（包含 `docker-compose.yml`）执行：

```bash
docker compose up -d --build
```

启动成功后：
- **前端访问**：[http://localhost:8088](http://localhost:8088)
- **SQLite 数据文件**：容器内 `/app/data/media_studio.db`

> [!NOTE]
> 默认数据库配置见 `docker-compose.yml`，数据卷 `media_studio_sqlite_data` 确保了即使容器销毁，作品数据依然安全。

### 方式二：本地开发运行

1. **安装依赖**：
   ```bash
   pip install -r requirements.txt
   ```
2. **设置环境变量（可选）**：
   - Windows (PowerShell): `$env:MEDIA_DB_URL="sqlite:///./media_studio.db"`
   - Linux/macOS: `export MEDIA_DB_URL="sqlite:///./media_studio.db"`
3. **启动服务**：
   ```bash
   uvicorn server:app --host 0.0.0.0 --port 8088 --reload
   ```

## 🔌 API 接口说明

系统内置了简洁的 RESTful API，方便扩展：

- `GET /api/health`: 检查服务状态及数据库连接。
- `GET /api/media`: 获取作品列表（支持 `image`, `video`, `all` 过滤）。
- `POST /api/media`: 插入单条媒体记录。
- `POST /api/media/batch`: 批量插入媒体记录。
- `DELETE /api/media/{id}`: 删除指定作品。

## 📁 SQLite 配置

修改环境变量 `MEDIA_DB_URL` 即可自定义数据库文件位置：
`sqlite:///./media_studio.db`（相对路径）
`sqlite:////absolute/path/media_studio.db`（绝对路径）

---

## 📄 开源许可证

本项目基于 MIT 许可证开源。请尽情使用并贡献您的代码！
