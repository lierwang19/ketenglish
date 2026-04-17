FROM nginx:alpine

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy project files
COPY . /usr/share/nginx/html/

# Remove files that don't belong in web root
RUN rm -f /usr/share/nginx/html/Dockerfile \
    /usr/share/nginx/html/docker-compose.yml \
    /usr/share/nginx/html/nginx.conf \
    /usr/share/nginx/html/plan.md \
    /usr/share/nginx/html/agent.md \
    /usr/share/nginx/html/claude.md

EXPOSE 80
