FROM public.ecr.aws/docker/library/node:22-slim
RUN npm install -g @anthropic-ai/claude-code
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY templates/ ./templates/
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh
ENTRYPOINT ["./entrypoint.sh"]
