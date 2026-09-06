FROM node:18-bullseye

WORKDIR /app

COPY package*.json ./

# 🔥 FIX for rollup bug
RUN rm -rf node_modules package-lock.json \
    && npm install --force

COPY . .

EXPOSE 4001 4002

CMD ["npm", "run", "dev", "--", "--host"]