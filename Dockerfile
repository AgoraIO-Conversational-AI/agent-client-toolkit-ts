# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8002

RUN useradd --create-home --uid 10001 app
WORKDIR /app

COPY apps/playground/server/requirements.txt /tmp/server-requirements.txt
RUN pip install --no-cache-dir -r /tmp/server-requirements.txt

COPY --chown=app:app apps/playground/server/src /app/server/src

USER app
EXPOSE 8002

CMD ["sh", "-c", "exec python -m uvicorn server.src.server:app --host 0.0.0.0 --port \"$PORT\""]
