FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/templates/default.conf.template
COPY docker/entrypoint.sh /docker-entrypoint.d/40-mapgeo-runtime-config.sh
COPY --from=build /app/dist /usr/share/nginx/html

ENV API_BASE_URL=/api
ENV BACKEND_UPSTREAM=http://web:8000

EXPOSE 80
