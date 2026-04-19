FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY index.html /usr/share/nginx/html/index.html
COPY vocab-review /usr/share/nginx/html/vocab-review
COPY listening-player /usr/share/nginx/html/listening-player
COPY shared /usr/share/nginx/html/shared

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
