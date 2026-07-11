FROM python:3.12-slim

WORKDIR /app

COPY apps/connector-ml/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/connector-ml/src ./src

ENV PORT=5030
ENV PYTHONPATH=/app/src
EXPOSE 5030

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5030", "--app-dir", "/app/src"]
