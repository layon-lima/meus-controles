FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv/app
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-por tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir "psycopg[binary]>=3.2,<4" "PyMuPDF>=1.25,<2" \
    && useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin controles
COPY . /srv/app
RUN python -m compileall -q /srv/app \
    && python -m unittest discover -s tests -p test_pg_compat.py -v \
    && python -m unittest discover -s tests -p test_pwa.py -v \
    && python -m unittest discover -s tests -p test_desktop_compact.py -v \
    && python -m unittest discover -s tests -p test_freights_v2.py -v \
    && python -m unittest discover -s tests -p test_truck_free_date.py -v \
    && python -m unittest discover -s tests -p test_vales.py -v \
    && python -m unittest discover -s tests -p test_vales_ui.py -v \
    && python -m unittest discover -s tests -p test_receiving_tabs.py -v \
    && python -m unittest discover -s tests -p test_receiving.py -v \
    && python -m unittest discover -s tests -p test_receiving_pdf.py -v
USER controles
EXPOSE 18765
CMD ["python", "app.py"]
