FROM node:22-slim
WORKDIR /app

# Install dependencies first so they are cached between builds.
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY web/package.json web/package-lock.json web/.npmrc ./web/
RUN npm --prefix web ci

COPY . .
RUN npm --prefix web run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
