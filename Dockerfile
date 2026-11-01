FROM node:22-slim
WORKDIR /app

# Install dependencies first so they are cached between builds.
COPY server/package.json server/package-lock.json server/.npmrc ./server/
RUN npm --prefix server ci
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./frontend/
RUN npm --prefix frontend ci

COPY server ./server
COPY frontend ./frontend
RUN npm --prefix frontend run build

ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app/server
CMD ["npm", "start"]
