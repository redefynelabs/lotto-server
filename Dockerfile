# Use Node 18
FROM node:18-alpine

# Create app directory  
WORKDIR /app

# Copy package.json + lock file
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy everything
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build NestJS
RUN npm run build

# Expose API port
EXPOSE 3000

# Run server
CMD ["npm", "run", "start:prod"]
