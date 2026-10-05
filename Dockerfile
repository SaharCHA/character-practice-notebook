# 1) Збирання даних: hanzi-writer.min.js та site/d/*.json
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# dictionary.txt необов'язковий: якщо його немає поруч, build.mjs завантажить сам
COPY build.mjs dictionary.txt* ./
COPY site/index.html site/
RUN node build.mjs

# 2) Роздача статики
FROM nginx:stable-alpine
# Порт усередині контейнера; хостинги на кшталт Render чи Railway задають PORT самі
ENV PORT=80
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/site /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/" || exit 1
