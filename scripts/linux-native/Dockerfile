ARG BASE_IMAGE=docker.io/library/almalinux:8@sha256:4a87d2615a770506e204c27d6248ac97f4df67f4e41e2e9c47c81f0ed0be98cb
FROM ${BASE_IMAGE}

ARG NODE_VERSION
ARG TARGETARCH

RUN dnf install -y \
      binutils \
      curl \
      gcc-toolset-11-gcc \
      gcc-toolset-11-gcc-c++ \
      gzip \
      make \
      python3.11 \
      tar \
      xz \
    && dnf clean all \
    && rm -rf /var/cache/dnf

RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) node_arch=x64 ;; \
      arm64) node_arch=arm64 ;; \
      *) echo "Unsupported Docker architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    archive="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    download() { \
      output="$1"; \
      url="$2"; \
      for attempt in 1 2 3 4 5; do \
        curl --fail --location --silent --show-error --output "${output}" "${url}" && return 0; \
        rm -f "${output}"; \
        if [ "${attempt}" -lt 5 ]; then sleep $((attempt * 2)); fi; \
      done; \
      return 1; \
    }; \
    download "/tmp/${archive}" "https://nodejs.org/dist/v${NODE_VERSION}/${archive}"; \
    download /tmp/SHASUMS256.txt "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; \
    grep " ${archive}$" /tmp/SHASUMS256.txt | (cd /tmp && sha256sum --check -); \
    mkdir -p /opt/node; \
    tar --extract --xz --file "/tmp/${archive}" --directory /opt/node --strip-components=1; \
    rm -f "/tmp/${archive}" /tmp/SHASUMS256.txt

ARG ELECTRON_VERSION
RUN set -eux; \
    archive="node-v${ELECTRON_VERSION}-headers.tar.gz"; \
    download() { \
      output="$1"; \
      url="$2"; \
      for attempt in 1 2 3 4 5; do \
        curl --fail --location --silent --show-error --output "${output}" "${url}" && return 0; \
        rm -f "${output}"; \
        if [ "${attempt}" -lt 5 ]; then sleep $((attempt * 2)); fi; \
      done; \
      return 1; \
    }; \
    mkdir -p /opt/electron-headers; \
    download "/opt/electron-headers/${archive}" \
      "https://npmmirror.com/mirrors/electron/v${ELECTRON_VERSION}/${archive}"; \
    download /tmp/ELECTRON_HEADERS_SHASUMS256.txt \
      "https://artifacts.electronjs.org/headers/dist/v${ELECTRON_VERSION}/SHASUMS256.txt"; \
    grep " ${archive}$" /tmp/ELECTRON_HEADERS_SHASUMS256.txt \
      | (cd /opt/electron-headers && sha256sum --check -); \
    rm -f /tmp/ELECTRON_HEADERS_SHASUMS256.txt

ENV PATH="/opt/node/bin:/opt/rh/gcc-toolset-11/root/usr/bin:${PATH}" \
    LD_LIBRARY_PATH="/opt/rh/gcc-toolset-11/root/usr/lib64:/opt/rh/gcc-toolset-11/root/usr/lib"

WORKDIR /opt/cherry-linux-native
COPY compat.js container-build.js ./

ENTRYPOINT ["node", "/opt/cherry-linux-native/container-build.js"]
