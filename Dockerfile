FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Copy package manifest and install dependencies first for better caching
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy source files
COPY . .

# Expose port and start the server
EXPOSE 4000
CMD ["node", "server.js"]
