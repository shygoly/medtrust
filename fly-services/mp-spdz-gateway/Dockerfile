FROM ubuntu:22.04

# Install dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    cmake \
    libssl-dev \
    libboost-all-dev \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Clone and build MP-SPDZ
WORKDIR /opt
RUN git clone https://github.com/data61/MP-SPDZ.git && \
    cd MP-SPDZ && \
    make -j4 tldr

# Install HTTP server dependencies
RUN pip3 install flask gunicorn

# Create gateway application
WORKDIR /app
COPY gateway.py /app/
COPY requirements.txt /app/

RUN pip3 install -r requirements.txt

# Expose port
EXPOSE 8080

# Run gateway
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "4", "--timeout", "300", "gateway:app"]
