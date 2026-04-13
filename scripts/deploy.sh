#!/bin/bash
# Home Mind Deployment Script
# Deploys home-mind-server and shodh using Docker Compose

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Home Mind Deployment"
echo "===================="

# Check for .env file
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo "ERROR: .env file not found"
    echo "Copy .env.example to .env and configure your settings:"
    echo "  cp .env.example .env"
    exit 1
fi

# Auto-generate SHODH_API_KEY if not set
SHODH_API_KEY=$(grep "^SHODH_API_KEY=" "$PROJECT_DIR/.env" 2>/dev/null | cut -d'=' -f2-)
if [ -z "$SHODH_API_KEY" ] || [ "$SHODH_API_KEY" = "your-shodh-api-key" ]; then
    GENERATED_KEY=$(openssl rand -hex 32)
    if grep -q "^SHODH_API_KEY=" "$PROJECT_DIR/.env"; then
        sed -i "s|^SHODH_API_KEY=.*|SHODH_API_KEY=$GENERATED_KEY|" "$PROJECT_DIR/.env"
    else
        echo "SHODH_API_KEY=$GENERATED_KEY" >> "$PROJECT_DIR/.env"
    fi
    echo "Generated SHODH_API_KEY automatically"
fi

# Check for Shodh binary
SHODH_BINARY="$PROJECT_DIR/docker/shodh/shodh-memory-server"
if [ ! -f "$SHODH_BINARY" ]; then
    echo "Shodh binary not found at: $SHODH_BINARY"
    echo ""
    
    # Check if it exists in home directory
    if [ -f "$HOME/shodh-memory-server" ]; then
        echo "Found Shodh binary at ~/shodh-memory-server"
        echo "Copying to docker/shodh/..."
        cp "$HOME/shodh-memory-server" "$SHODH_BINARY"
        chmod +x "$SHODH_BINARY"
    else
        echo "ERROR: Cannot find Shodh binary"
        echo "Please place shodh-memory-server in docker/shodh/"
        exit 1
    fi
fi

# Ensure HomeMind App source is present (sibling directory) — optional
APP_DIR="$(dirname "$PROJECT_DIR")/home-mind-app"
COMPOSE_PROFILES=""
if [ -d "$APP_DIR/.git" ]; then
    echo "Updating home-mind-app..."
    git -C "$APP_DIR" pull
    COMPOSE_PROFILES="app"
elif [ -d "$APP_DIR" ]; then
    echo "Using existing home-mind-app directory"
    COMPOSE_PROFILES="app"
else
    echo "NOTE: home-mind-app not found at $APP_DIR (skipping PWA frontend)"
    echo "  The server and memory backend will work without it."
    echo "  To include the frontend later, clone it as a sibling directory."
fi

echo "Building and starting containers..."
cd "$PROJECT_DIR"

# Build and start (include app profile only if home-mind-app is available)
if [ -n "$COMPOSE_PROFILES" ]; then
    COMPOSE_PROFILES="$COMPOSE_PROFILES" docker compose build
    COMPOSE_PROFILES="$COMPOSE_PROFILES" docker compose up -d
else
    docker compose build
    docker compose up -d
fi

echo ""
echo "Waiting for services to be healthy..."
sleep 5

# Check health
echo ""
echo "Service Status:"
docker compose ps

echo ""
echo "Testing API..."
if curl -s http://localhost:3100/api/health | grep -q "ok"; then
    echo "✓ Home Mind API is healthy"
else
    echo "✗ API health check failed"
    echo "Check logs with: docker compose logs"
    exit 1
fi

echo ""
echo "Deployment complete!"
echo "API available at: http://localhost:3100"
