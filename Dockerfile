FROM node:20-slim
WORKDIR /app

# openssl: Prisma engine detection. poppler-utils: pdftotext, used to parse
# Shopee waybill PDFs (lib/zalo/parseWaybill.ts).
RUN apt-get update -y && apt-get install -y openssl poppler-utils && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start"]
