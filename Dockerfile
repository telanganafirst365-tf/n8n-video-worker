FROM node:18-alpine
# Install FFmpeg
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY . .
RUN npm install
CMD ["node", "index.js"]
