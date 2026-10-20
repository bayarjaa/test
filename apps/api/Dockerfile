FROM node:22-bookworm
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx prisma generate && npm run build
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
