FROM node:20-slim

# Install Python 3 + pip into the Node base image
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (cached layer)
COPY requirements.txt ./
RUN pip3 install --break-system-packages -r requirements.txt

# Install Node dependencies (cached layer)
COPY package.json package-lock.json ./
RUN npm ci

# Copy all source code
COPY . .

# Build Next.js standalone
RUN npm run build

# Copy static assets into standalone output so they're served correctly
RUN cp -r .next/static .next/standalone/.next/static && \
    if [ -d public ]; then cp -r public .next/standalone/public; fi

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", ".next/standalone/server.js"]
