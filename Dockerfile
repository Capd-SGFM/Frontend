FROM node:20-bullseye AS dev

WORKDIR /app

COPY package*.json ./

RUN npm ci && \
    npm install jwt-decode @types/jwt-decode axios --save && \
    npm install --save-dev @types/axios

COPY . .
ENV CHOKIDAR_USEPOLLING=true
ENV WATCHPACK_POLLING=true
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# Production build stage
FROM node:20-bullseye AS build

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

ARG VITE_BACKEND_URL
ARG VITE_BACKTESTING_BACKEND_URL
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
ENV VITE_BACKTESTING_BACKEND_URL=$VITE_BACKTESTING_BACKEND_URL
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

RUN npm run build

# Production runtime stage with Nginx
FROM nginx:alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
