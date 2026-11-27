FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
RUN pip install --no-cache-dir "psycopg[binary]>=3.2,<4" \
    && useradd --uid 10002 --create-home --shell /usr/sbin/nologin central
COPY central_admin /srv/central_admin
USER central
EXPOSE 18771
CMD ["python", "-m", "central_admin.server"]
