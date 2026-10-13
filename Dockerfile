FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY server.js ./
COPY public ./public
EXPOSE 4173
CMD ["npm", "start"]
