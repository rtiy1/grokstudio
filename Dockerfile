FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV MEDIA_DB_URL=mysql+pymysql://media_user:media_password@mysql:3306/media_studio?charset=utf8mb4

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . /app

EXPOSE 8088

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8088"]
