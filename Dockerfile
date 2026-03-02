# Use Node.js 20 LTS for better performance and stability
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install dependencies
# Use npm ci for reproducible builds in production
RUN npm ci --only=production || npm install --only=production

# Copy source files
COPY . .

# Expose port 3001
EXPOSE 3001

# Set production environment
ENV NODE_ENV=production

# Start the application
CMD ["node", "src/index.js"]
