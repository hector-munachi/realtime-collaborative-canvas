FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/sync/package.json apps/sync/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install
COPY . .
EXPOSE 1234
CMD ["npm", "run", "start", "-w", "apps/sync"]
