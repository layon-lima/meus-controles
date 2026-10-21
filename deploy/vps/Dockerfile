FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv/app
RUN pip install --no-cache-dir "psycopg[binary]>=3.2,<4" \
    && useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin controles
COPY . /srv/app
USER controles
EXPOSE 18765
CMD ["python", "app.py"]
