FROM node:18-alpine
RUN apk add --no-cache ffmpeg fontconfig

# Copy fonts
RUN mkdir -p /usr/local/share/fonts
COPY Poppins-Bold.ttf /usr/local/share/fonts/Poppins-Bold.ttf
RUN fc-cache -fv

# Set workdir and copy files
WORKDIR /app
COPY . .

# Install deps
RUN npm install

# THIS IS THE CRITICAL LINE
EXPOSE 7860

CMD ["node", "index.js"]
