#!/bin/bash

# WebP Converter Docker Setup Script

set -e

echo "🐳 WebP Converter CLI Docker Setup"
echo "==================================="

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found. Please create .env file with required environment variables."
    exit 1
fi

echo "✅ Prerequisites check passed"

# Build image
echo "🔨 Building Docker image..."
docker-compose build webp-cli

echo "🎉 Setup complete!"
echo ""
echo "🚀 CLI Usage Examples:"
echo "=================================="
echo ""
echo "# Health check"
echo "docker-compose run --rm webp-cli npm run cli health"
# echo ""
# echo "# Start image conversion"
# echo "docker-compose run --rm webp-cli npm run cli convert"
echo ""
echo "# Run with custom command"
echo "docker-compose run --rm webp-cli node dist/cli.js health"
echo ""
echo "📊 Optional: Start monitoring server"
echo "docker-compose --profile server up -d webp-server"
echo "# Then access: http://localhost:8001/health"
echo ""
echo "📋 View logs from previous runs:"
echo "ls -la logs/"