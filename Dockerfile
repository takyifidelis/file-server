# Use official Node.js LTS image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN npm install --production

# Copy source code and storage directory
COPY src ./src

#check directory
RUN ls -la ./src

# Expose port
EXPOSE 3005

# Start the server
CMD ["node", "src/index.js"]
