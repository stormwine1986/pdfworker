# Use Node.js with Debian as base
FROM node:20-slim

# Install dependencies
RUN apt-get update && apt-get install -y \
    wget \
    unzip \
    gnupg \
    fonts-noto-cjk \
    python3 \
    python3-dev \
    python3-pip \
    python3-venv \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && wget https://storage.googleapis.com/chrome-for-testing-public/131.0.6778.204/linux64/chromedriver-linux64.zip \
    && unzip chromedriver-linux64.zip \
    && mv chromedriver-linux64/chromedriver /usr/bin/chromedriver \
    && rm -rf chromedriver-linux64 chromedriver-linux64.zip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory.
WORKDIR /usr/src/app

# Install Python dependencies
COPY requirements.txt .
RUN python3 -m venv .venv \
    && . .venv/bin/activate \
    && pip3 install -r requirements.txt \
    && rm -rf ~/.cache/pip

# Copy package.json and package-lock.json.
COPY package*.json ./
RUN npm install

# Copy the rest of the application code.
COPY . .

# Setup entrypoint
COPY entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh

COPY recipe.toml /root/.pdfworker/config/

# Expose the port the app runs on.
EXPOSE 5000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["npm", "start"]