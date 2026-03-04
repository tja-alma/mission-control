FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src/ src/
COPY public/ public/
RUN npx tsc
RUN mkdir -p data
EXPOSE 3500
CMD ["node", "dist/index.js"]
