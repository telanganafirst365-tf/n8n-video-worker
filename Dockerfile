# Use an official Node runtime as a parent image
FROM node:18-bullseye

# Install FFmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy package config and install base dependencies
COPY package*.json ./
RUN npm install

# THE FIX: Explicitly install the S3/R2 Cloud SDK
RUN npm install @aws-sdk/client-s3

# Explicitly force Docker to copy the assets
COPY logos/ ./logos/
COPY Poppins-Bold.ttf ./
COPY index.js ./

# Expose the port
EXPOSE 7860

# Command to run the application
CMD ["node", "index.js"]
