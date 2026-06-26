FROM node:18-alpine
RUN apk add --no-cache ffmpeg fontconfig

# Copy fonts
RUN mkdir -p /usr/local/share/fonts
COPY Poppins-Bold.ttf /usr/local/share/fonts/Poppins-Bold.ttf
RUN fc-cache -fv

# Copy logos - This correctly pulls from the logos/ folder you just created
COPY logos/ /app/logos/

WORKDIR /app
COPY . .
RUN npm install
CMD ["node", "index.js"]
