# Use official Node.js LTS image
FROM node:alpine

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN npm install --production

# Copy source code and storage directory
COPY src ./src
COPY .env ./.env
COPY openapi.json ./openapi.json

#check directory
RUN ls -la ./src

# Expose port
EXPOSE 3005

# Start the server
CMD ["node", "src/index.js"]
