#!/bin/bash
# Complete load test runner with Docker metrics collection
# Usage: ./run_load_test.sh [container_name]

set -e

CONTAINER=${1:-"aem-publish-4503"}
# Sampling interval in seconds (lower = more accurate peaks, more data)
# Note: docker stats --no-stream has ~1s overhead, so effective interval is STATS_INTERVAL + ~1s
# Going below 0.25s has diminishing returns due to docker stats overhead
STATS_INTERVAL=0.25
STATS_FILE="docker-stats.json"
K6_OUTPUT="k6-results.json"
K6_SCRIPT="ping_logger_load_test_k6.js"
ENV_FILE="test-environment.json"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           k6 Load Test with Docker Metrics                   ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    echo "❌ Error: Container '$CONTAINER' is not running"
    echo "   Available containers:"
    docker ps --format '   - {{.Names}}'
    exit 1
fi

# Check if k6 is installed
if ! command -v k6 &> /dev/null; then
    echo "❌ Error: k6 is not installed"
    echo "   Install: brew install k6"
    exit 1
fi

# Clean up previous results
rm -f "$STATS_FILE" "$K6_OUTPUT" "$ENV_FILE"

# ══════════════════════════════════════════════════════════════════
# Capture Environment Metadata
# ══════════════════════════════════════════════════════════════════
echo "📋 Capturing environment metadata..."

# Get Docker container details
CONTAINER_IMAGE=$(docker inspect "$CONTAINER" --format '{{.Config.Image}}' 2>/dev/null || echo "unknown")
CONTAINER_ID=$(docker inspect "$CONTAINER" --format '{{.Id}}' 2>/dev/null | cut -c1-12 || echo "unknown")

# Get container resource limits
CPU_LIMIT=$(docker inspect "$CONTAINER" --format '{{.HostConfig.NanoCpus}}' 2>/dev/null || echo "0")
if [ "$CPU_LIMIT" = "0" ] || [ -z "$CPU_LIMIT" ]; then
    CPU_LIMIT="unlimited"
else
    CPU_LIMIT=$(echo "scale=2; $CPU_LIMIT / 1000000000" | bc)"cores"
fi

MEM_LIMIT=$(docker inspect "$CONTAINER" --format '{{.HostConfig.Memory}}' 2>/dev/null || echo "0")
if [ "$MEM_LIMIT" = "0" ] || [ -z "$MEM_LIMIT" ]; then
    MEM_LIMIT="unlimited"
else
    MEM_LIMIT=$(echo "scale=2; $MEM_LIMIT / 1073741824" | bc)"GB"
fi

# Get host machine details
HOST_OS=$(uname -s)
HOST_ARCH=$(uname -m)
HOST_CPUS=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo "unknown")
HOST_MEM=$(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.1fGB", $1/1073741824}' 2>/dev/null || free -h 2>/dev/null | awk '/^Mem:/{print $2}' || echo "unknown")

# Get Docker version
DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "unknown")

# Get Java/AEM version if accessible (via container exec)
JAVA_VERSION=$(docker exec "$CONTAINER" java -version 2>&1 | head -1 | awk -F '"' '{print $2}' 2>/dev/null || echo "unknown")

# Get test timestamp
TEST_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TEST_DATE_LOCAL=$(date +"%Y-%m-%d %H:%M:%S %Z")

# Write environment file
cat > "$ENV_FILE" << EOF
{
  "testDate": "$TEST_DATE",
  "testDateLocal": "$TEST_DATE_LOCAL",
  "container": {
    "name": "$CONTAINER",
    "id": "$CONTAINER_ID",
    "image": "$CONTAINER_IMAGE",
    "cpuLimit": "$CPU_LIMIT",
    "memLimit": "$MEM_LIMIT"
  },
  "host": {
    "os": "$HOST_OS",
    "arch": "$HOST_ARCH",
    "cpus": "$HOST_CPUS",
    "memory": "$HOST_MEM"
  },
  "versions": {
    "docker": "$DOCKER_VERSION",
    "java": "$JAVA_VERSION",
    "k6": "$(k6 version 2>/dev/null | head -1 || echo 'unknown')"
  },
  "notes": "Local Docker environment - NOT production baseline"
}
EOF

echo ""
echo "🖥️  Host: $HOST_OS $HOST_ARCH | $HOST_CPUS CPUs | $HOST_MEM RAM"
echo "🐳 Container: $CONTAINER ($CONTAINER_IMAGE)"
echo "   CPU Limit: $CPU_LIMIT | Memory Limit: $MEM_LIMIT"
echo "   Java: $JAVA_VERSION"
echo ""

# ══════════════════════════════════════════════════════════════════
# Docker Stats Collection
# ══════════════════════════════════════════════════════════════════

collect_stats() {
    while true; do
        STATS=$(docker stats "$CONTAINER" --no-stream --format '{"cpu":"{{.CPUPerc}}","mem":"{{.MemPerc}}","mem_usage":"{{.MemUsage}}"}' 2>/dev/null)
        if [ -n "$STATS" ]; then
            TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
            echo "{\"time\":\"$TIMESTAMP\",${STATS:1}" >> "$STATS_FILE"
        fi
        sleep "$STATS_INTERVAL"
    done
}

echo "📈 Starting Docker metrics collection (every ~1.5s, interval=${STATS_INTERVAL}s + docker overhead)..."
collect_stats &
STATS_PID=$!

cleanup() {
    echo ""
    echo "🛑 Stopping metrics collection..."
    kill $STATS_PID 2>/dev/null || true
    wait $STATS_PID 2>/dev/null || true
}
trap cleanup EXIT

sleep 1

# ══════════════════════════════════════════════════════════════════
# Run k6 Load Test
# ══════════════════════════════════════════════════════════════════
echo "🚀 Starting k6 load test..."
echo "───────────────────────────────────────────────────────────────"
echo ""

k6 run --out json="$K6_OUTPUT" "$K6_SCRIPT"

echo ""
echo "───────────────────────────────────────────────────────────────"

# Count collected data points
STATS_COUNT=$(wc -l < "$STATS_FILE" 2>/dev/null | tr -d ' ')
K6_LINES=$(wc -l < "$K6_OUTPUT" 2>/dev/null | tr -d ' ')

echo ""
echo "✅ Test complete!"
echo "   📦 Docker stats: $STATS_COUNT data points"
echo "   📊 k6 results: $K6_LINES lines"
echo "   📋 Environment: $ENV_FILE"
echo ""

# Ask to generate chart
read -p "📈 Generate analysis chart? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🎨 Generating chart..."
    node plot_k6_results.js
fi

echo ""
echo "🎉 Done!"
