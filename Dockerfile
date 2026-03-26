FROM node:22-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.17.0 --activate

# Install dependencies first (cached layer)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 5173

CMD ["pnpm", "run", "start", "--host", "0.0.0.0"]
