FROM node:22-slim
RUN npm install -g @anthropic-ai/claude-code
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY src/ ./src/
COPY templates/ ./templates/
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh
ENTRYPOINT ["./entrypoint.sh"]
