FROM node:20-bullseye AS dev

WORKDIR /app

COPY package*.json ./

RUN npm ci && \
    npm install jwt-decode @types/jwt-decode axios --save && \
    npm install --save-dev @types/axios

COPY . .

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
