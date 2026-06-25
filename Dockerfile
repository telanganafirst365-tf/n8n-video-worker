FROM node:18-alpine
# Install FFmpeg and Fontconfig
RUN apk add --no-cache ffmpeg fontconfig

# Create directory and copy your custom font
RUN mkdir -p /usr/local/share/fonts
COPY Poppins-Bold.ttf /usr/local/share/fonts/Poppins-Bold.ttf

# Refresh the font cache so FFmpeg can see it
RUN fc-cache -fv

WORKDIR /app
COPY . .
RUN npm install
CMD ["node", "index.js"]
