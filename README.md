# Grok 媒体工具站（独立项目，MySQL 版）

这是一个可单独发布的项目，包含：

- 前端页面：生图、图生图、图转视频
- 后端接口：`FastAPI`
- 数据库存储：`MySQL`（用于作品库查看与删除）

## 功能说明

- 支持填写 `API URL` 和 `API Key` 调用你的后端接口。
- 生图与图生图结果会自动写入 `MySQL`。
- 页面提供“作品库”界面，可查看历史图片并单条删除。

## 一键 Docker 部署（内置 MySQL）

在当前目录（`studio/`）执行：

```bash
docker compose up -d --build
```

启动后访问：

- 前端：`http://localhost:8088`
- MySQL：`localhost:3307`

默认数据库配置（`docker-compose.yml`）：

- DB：`media_studio`
- User：`media_user`
- Password：`media_password`

## 数据库说明

- 表名：`media_assets`
- MySQL 数据卷：`media_studio_mysql_data`
- 容器重建后数据仍保留（只要不删 volume）。

## 切换到外部 MySQL（可选）

将 `media-studio` 服务的 `MEDIA_DB_URL` 改为你自己的连接串，例如：

```text
mysql+pymysql://user:password@host:3306/media_studio?charset=utf8mb4
```

## 本地开发运行（不使用 Docker）

1) 准备 MySQL 数据库（例如 `media_studio`）  
2) 设置环境变量 `MEDIA_DB_URL`  
3) 启动服务：

```bash
pip install -r requirements.txt
$env:MEDIA_DB_URL="mysql+pymysql://user:password@127.0.0.1:3306/media_studio?charset=utf8mb4"
uvicorn server:app --host 0.0.0.0 --port 8088 --reload
```

## 作为独立 Git 项目发布

如果你当前还在大仓库里，推荐复制一份到新目录再发布：

```powershell
Copy-Item -Path .\studio -Destination .\grok-media-studio -Recurse
Set-Location .\grok-media-studio
git init
git add .
git commit -m "feat: 初始化独立媒体工具站（MySQL 作品库）"
git branch -M main
git remote add origin https://github.com/<你的用户名>/grok-media-studio.git
git push -u origin main
```

如果你安装了 GitHub CLI，也可以在新目录执行：

```bash
gh repo create grok-media-studio --public --source . --remote origin --push
```
