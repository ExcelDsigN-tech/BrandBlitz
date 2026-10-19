FROM nginx:1.25-alpine AS builder

RUN apk add --no-cache --virtual .build-deps \
    git \
    gcc \
    libc-dev \
    make \
    openssl-dev \
    pcre-dev \
    zlib-dev \
    linux-headers \
    curl

WORKDIR /tmp

# --- Supply-chain hardening -----------------------------------------------
# ngx_brotli: pinned to an immutable commit SHA instead of the mutable v1.1.0
# tag.  To upgrade: fetch the new HEAD SHA from
#   git ls-remote https://github.com/google/ngx_brotli.git HEAD
# then replace the SHA below and re-run the build.
# SHA corresponds to master HEAD as of 2026-10-17.
ARG NGX_BROTLI_COMMIT=a71f9312c2deb28875acc7bacfdd5695a111aa53

RUN git clone https://github.com/google/ngx_brotli.git && \
    cd ngx_brotli && \
    git checkout "${NGX_BROTLI_COMMIT}" && \
    git submodule update --init --depth 1

WORKDIR /tmp

# nginx source tarball: verified against the published sha256sum before
# compiling.  To upgrade: download the new tarball from nginx.org/download,
# run `sha256sum nginx-X.Y.Z.tar.gz`, and update NGINX_SOURCE_SHA256 below.
# Current value is for nginx 1.25.5 — matching the nginx:1.25-alpine base image.
ARG NGINX_VERSION=1.25.5
ARG NGINX_SOURCE_SHA256=2fe2294f8af4144e7e842eaea884182a84ee7970e11046ba98194400902bbec0

RUN curl -sSL "https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz" -o nginx.tar.gz && \
    # Fail the build immediately if the checksum does not match.
    echo "${NGINX_SOURCE_SHA256}  nginx.tar.gz" | sha256sum -c - && \
    tar -xzf nginx.tar.gz && \
    cd nginx-${NGINX_VERSION} && \
    ./configure \
      --with-compat \
      --add-dynamic-module=/tmp/ngx_brotli && \
    make -j$(nproc) modules && \
    mkdir -p /tmp/modules && \
    cp objs/ngx_http_brotli_filter_module.so /tmp/modules/ && \
    cp objs/ngx_http_brotli_static_module.so /tmp/modules/

FROM nginx:1.25-alpine AS runner

COPY --from=builder /tmp/modules/ /usr/lib/nginx/modules/
