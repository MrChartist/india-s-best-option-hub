FROM node:18-bullseye

WORKDIR /app

COPY package*.json ./

# 🔥 FIX for rollup bug
RUN rm -rf node_modules package-lock.json \
    && npm install --force

COPY . .

# Inside a container the proxy must listen on all interfaces; publish the ports on 127.0.0.1 only (see README)
ENV PROXY_HOST=0.0.0.0

EXPOSE 4001 4002

CMD ["npm", "run", "dev", "--", "--host"]