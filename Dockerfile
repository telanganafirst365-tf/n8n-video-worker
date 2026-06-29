# Use an official Node runtime as a parent image
FROM node:18-bullseye

# Install FFmpeg (Crucial for your video processing)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy package.json and install dependencies first (Optimizes build cache)
COPY package*.json ./
RUN npm install

# THE FIX: Copy EVERYTHING from GitHub into the /app folder
# This includes index.js, the logos folder, and the Poppins fonts
COPY . .

# Expose the port Hugging Face expects
EXPOSE 7860

# Command to run the application
CMD ["node", "index.js"]
