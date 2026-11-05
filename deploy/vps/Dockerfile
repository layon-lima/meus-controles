FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv/app
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-por tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir "psycopg[binary]>=3.2,<4" "PyMuPDF>=1.25,<2" "XlsxWriter>=3.2,<4" \
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
    && python -m unittest discover -s tests -p test_receiving_pdf.py -v \
    && python -m unittest discover -s tests -p test_receiving_xml.py -v \
    && python -m unittest discover -s tests -p test_control_types.py -v \
    && python -m unittest discover -s tests -p test_receiving_consolidation.py -v \
    && python -m unittest discover -s tests -p test_pair.py -v \
    && python -m unittest discover -s tests -p test_pair_records.py -v \
    && python -m unittest discover -s tests -p test_reports_excel.py -v \
    && python -m unittest discover -s tests -p test_receiving_invoices_excel.py -v \
    && python -m unittest discover -s tests -p test_emitentes_nf.py -v
USER controles
EXPOSE 18765
CMD ["python", "app.py"]
