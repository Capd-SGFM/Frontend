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
