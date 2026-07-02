# MedTrust FL — real Flower SuperLink (federated learning server), replaces the mock.
FROM python:3.11-slim
RUN pip install --no-cache-dir "flwr==1.13.1"
# ServerAppIo API :9091, Fleet API :9092, Exec API :9093 — bound to all interfaces.
EXPOSE 9091 9092 9093
CMD ["flower-superlink", "--insecure", \
     "--serverappio-api-address", "0.0.0.0:9091", \
     "--fleet-api-address", "0.0.0.0:9092", \
     "--exec-api-address", "0.0.0.0:9093"]
