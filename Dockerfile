# Use Node 18
FROM node:18-alpine

# Create app directory  
WORKDIR /app

# Copy package.json + lock file
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build NestJS project
RUN npm run build

# Expose port
EXPOSE 5000

# Start production server
CMD ["npm", "run", "start:prod"]
