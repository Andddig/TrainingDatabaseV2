FROM node:18-alpine

WORKDIR /app

# Install Chromium for Puppeteer PDF generation
RUN apk add --no-cache \
	chromium \
	nss \
	freetype \
	harfbuzz \
	ttf-freefont

# Use system Chromium in containers (avoids missing bundled Chrome cache issues)
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Create necessary directories
RUN mkdir -p public/uploads

# Expose the port the app runs on
EXPOSE 3000

# Command to run the application
CMD ["npm", "start"] 