# AEM API Performance Testing Suite

A comprehensive load testing framework for Adobe Experience Manager (AEM) environments using **k6** with integrated Docker container monitoring and automated visualization.

## Features

- **k6 Load Testing** - Industry-standard load testing with configurable VU stages
- **Docker Metrics Collection** - Real-time CPU/memory monitoring of AEM containers
- **Automated Visualization** - Generate charts correlating VUs, latency, and CPU usage
- **Environment Capture** - Automatically records host/container specs for reproducibility

## Prerequisites

| Tool | Installation |
|------|-------------|
| **k6** | `brew install k6` |
| **Node.js** | v18+ required for chart generation |
| **Docker** | For container metrics collection |

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Run the complete test suite

```bash
./run_load_test.sh aem-publish-4503
```

This single command:
1. Validates the Docker container is running
2. Captures environment metadata (host specs, container limits, Java version)
3. Starts Docker stats collection in the background
4. Runs the k6 load test
5. Stops metrics collection
6. Prompts to generate the analysis chart

### 3. Generate chart manually (if needed)

```bash
node plot_k6_results.js
```

## Project Structure

```
├── run_load_test.sh          # Main orchestrator script
├── ping_logger_load_test_k6.js  # k6 test definition
├── plot_k6_results.js        # Chart generation script
├── package.json              # Node.js dependencies
│
├── k6-results.json           # k6 output (generated)
├── docker-stats.json         # Container metrics (generated)
├── test-environment.json     # Environment metadata (generated)
└── k6-load-test-analysis.png # Analysis chart (generated)
```

## Load Profile

The default test ramps up to **1000 concurrent users**:

| Duration | Target VUs | Phase |
|----------|-----------|-------|
| 1 min | 50 | Warm-up |
| 2 min | 100 | Ramp-up |
| 2 min | 250 | Ramp-up |
| 2 min | 500 | Ramp-up |
| 2 min | 750 | Stress |
| 2 min | 1000 | Peak |
| 1 min | 0 | Cool-down |

**Total duration: ~12 minutes**

### Customizing the Load Profile

Edit `ping_logger_load_test_k6.js`:

```javascript
export const options = {
  stages: [
    { duration: '1m', target: 100 },   // Adjust as needed
    { duration: '5m', target: 500 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],      // <1% error rate
    http_req_duration: ['p(95)<2000'],   // p95 latency < 2s
  },
};
```

## Output

### Generated Chart

The analysis chart includes:

- **Concurrent Users (VUs)** - Orange line, left axis
- **Response Time P95 (ms)** - Blue line, right axis  
- **Container CPU %** - Red dashed line, right axis

The chart header includes full environment details:
```
Host: Darwin arm64 | 10 CPUs | 16.0GB RAM
Container: aem-publish-4503 (adobe/aem:6.5) | CPU: unlimited | Memory: 8GB
Java: 11.0.12 | Docker: 24.0.6 | Test: 2026-01-18 15:30:00 IST
```

### Console Summary

```
╔══════════════════════════════════════════════════════════════╗
║                    TEST SUMMARY                              ║
╠══════════════════════════════════════════════════════════════╣
║  👥 Max Concurrent Users:      1000                          ║
║  ⏱️  Avg Response Time (P95):  245.3 ms                      ║
║  ⏱️  Max Response Time (P95): 1823.5 ms                      ║
║  🔥 Avg CPU Usage:             67.2 %                        ║
║  🔥 Max CPU Usage:             94.8 %                        ║
╚══════════════════════════════════════════════════════════════╝
```

## Production Correlation

### Estimating Production Capacity

1. Find the **inflection point** - the VU count where latency starts degrading
2. Note the **CPU %** at that point (your capacity threshold)

### Caveats

- Local Docker networking adds overhead
- JVM tuning differs between environments
- Disk I/O, caching, and CDN not simulated
- **Always validate with production testing**

## Thresholds

Default pass/fail criteria:

| Metric | Threshold | Description |
|--------|-----------|-------------|
| `http_req_failed` | < 5% | Error rate |
| `http_req_duration` | p95 < 5000ms | 95th percentile latency |

k6 will exit with code 99 if thresholds are breached.

## Running Without Docker Metrics

If you just want k6 results without container monitoring:

```bash
k6 run --out json=k6-results.json ping_logger_load_test_k6.js
node plot_k6_results.js
```

The chart will show VUs and latency without CPU data.

## Troubleshooting

### "Container not found"

```bash
# List running containers
docker ps --format '{{.Names}}'

# Run with correct container name
./run_load_test.sh your-container-name
```

### High error rate at scale

- Your local machine may be the bottleneck
- Check Docker resource limits: `docker inspect <container> | grep -A 10 HostConfig`
- Reduce max VUs or add sleep time between requests

### k6 resource limits

For 1000+ VUs, ensure your machine has:
- At least 4 CPU cores available
- 8GB+ RAM
- Increase file descriptor limits: `ulimit -n 65535`

## Dependencies

| Package | Purpose |
|---------|---------|
| `chart.js` | Chart rendering engine |
| `chartjs-node-canvas` | Server-side chart generation |
