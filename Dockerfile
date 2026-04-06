FROM node:20-slim

# Install Python 3 + pip into the Node base image
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Railway injects service variables at build time for Dockerfile deploys,
# but Dockerfiles must declare them explicitly to make them available.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG APP_BASE_URL

ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
ENV APP_BASE_URL=${APP_BASE_URL}

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
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000
EXPOSE 3000

CMD ["node", ".next/standalone/server.js"]
