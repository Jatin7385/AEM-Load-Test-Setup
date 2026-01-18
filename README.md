# AEM Performance Testing Suite

Load testing framework for Adobe Experience Manager (AEM) using k6, Docker, and automated metrics collection.

## 📋 Overview

This project provides a complete load testing solution for AEM instances running in Docker containers. It includes:

- **Dockerized AEM Publish** instance with optimized JVM settings
- **k6 load testing** with configurable virtual users and ramp-up profiles
- **Automated Docker metrics collection** (CPU, memory usage)
- **Graphical analysis** with response time, concurrent users, and CPU correlation
- **Test environment metadata** capture for reproducible results

---

## 🚀 Quick Start

### Prerequisites

- **Docker Desktop** (macOS/Windows) or Docker Engine (Linux)
- **Node.js** 18+ (for plotting)
- **k6** load testing tool: `brew install k6` (macOS) or [download](https://k6.io/docs/getting-started/installation/)
- **AEM 6.5 Publish JAR** (`aem-publish-p4503.jar`)
- **AEM License file** (`license.properties`)

---

## 📁 Project Structure

```
performance_testing/
├── docker-compose.yml           # Docker orchestration
├── publish/                     # AEM Publish setup
│   ├── Dockerfile              # AEM container image
│   ├── aem-publish-p4503.jar   # ⚠️ YOU PROVIDE THIS
│   ├── license.properties      # ⚠️ YOU PROVIDE THIS
│   └── crx-quickstart/         # Generated after first run
└── tests/                       # k6 load tests
    ├── run_load_test.sh        # Main test runner
    ├── ping_logger_load_test_k6.js  # k6 test script
    ├── plot_k6_results.js      # Results visualization
    └── package.json            # Node dependencies
```

---

## 🛠️ Setup Instructions

### Step 1: Place AEM Files

You need to provide your own AEM files (not included in this repository):

1. **Get AEM JAR file** from Adobe Package Share or your organization
   - Place it at: `publish/aem-publish-p4503.jar`

2. **Get license.properties** from your AEM license
   - Place it at: `publish/license.properties`

```bash
# Expected structure after setup:
publish/
├── Dockerfile
├── aem-publish-p4503.jar    # ← You add this (532 MB)
└── license.properties        # ← You add this
```

### Step 2: Install Dependencies

```bash
# Install k6 (if not already installed)
brew install k6

# Install Node.js dependencies for plotting
cd tests
npm install
```

### Step 3: Build & Start AEM

```bash
# Build the Docker image
docker-compose build --no-cache

# Start AEM Publish
docker-compose up -d

# Monitor logs
docker-compose logs -f
```

**⏱️ First startup takes ~3-5 minutes** as AEM unpacks and initializes.

Check when ready:
```bash
curl http://localhost:4503/system/console/healthcheck.json
```

---

## 🧪 Running Load Tests

### Basic Test

```bash
cd tests
./run_load_test.sh
```

This will:
1. Capture environment metadata
2. Start Docker metrics collection (CPU, memory)
3. Run k6 load test with 12-minute ramp-up profile
4. Generate analysis charts automatically

### Test Configuration

Edit `tests/ping_logger_load_test_k6.js` to customize:

```javascript
stages: [
  { duration: '1m', target: 50 },     // Warm-up
  { duration: '2m', target: 100 },    // Ramp-up
  { duration: '2m', target: 250 },
  { duration: '2m', target: 500 },
  { duration: '2m', target: 750 },
  { duration: '2m', target: 1000 },   // Peak load
  { duration: '1m', target: 0 },      // Cool-down
],
```

**Fast 4-minute test** (for iteration):
```javascript
stages: [
  { duration: '30s', target: 100 },
  { duration: '1m', target: 500 },
  { duration: '1m', target: 1000 },
  { duration: '1m', target: 1000 },   // Hold at peak
  { duration: '30s', target: 0 },
],
```

### Custom Endpoint

Edit the URL in `tests/ping_logger_load_test_k6.js`:

```javascript
const URL = 'http://localhost:4503/content/your-endpoint.json';
```

---

## 📊 Understanding Results

### Test Outputs

After a test run, you'll get:

1. **`k6-results.json`** - Raw k6 metrics (~1.5M lines)
2. **`docker-stats.json`** - CPU/memory samples (~300 lines)
3. **`test-environment.json`** - Test metadata
4. **`k6-load-test-analysis.png`** - Visual analysis graph

### Analysis Graph

The generated graph shows:

- **🟠 Orange Area**: Concurrent Users (VUs) over time
- **🔵 Blue Line**: Response Time P95 (95th percentile latency)
- **🔴 Red Dashed**: Container CPU % (100% = 1 core)

### Key Metrics Summary

```
╔══════════════════════════════════════════════════════════════╗
║                    TEST SUMMARY                              ║
╠══════════════════════════════════════════════════════════════╣
║  👥 Max Concurrent Users:    1000                            ║
╠──────────────────────────────────────────────────────────────╣
║  📊 RESPONSE TIME (P95):                                     ║
║     Min:     XXX.X ms                                        ║
║     Avg:     XXX.X ms                                        ║
║     Max:     XXX.X ms                                        ║
╠──────────────────────────────────────────────────────────────╣
║  🔥 CPU UTILIZATION:                                         ║
║     Min:     XX.X % (X.X cores)                              ║
║     Avg:    XXX.X % (X.X cores)                              ║
║     Max:    XXX.X % (X.X of 16 cores)                        ║
╚══════════════════════════════════════════════════════════════╝
```

### What to Look For

1. **Inflection Point** - Where latency starts to spike (capacity limit)
2. **CPU Correlation** - CPU % when latency degrades
3. **Sustained Performance** - Stability during peak hold period
4. **Error Rate** - Should be < 5% (`http_req_failed`)

---

## 🔧 Configuration

### Docker Resources

Adjust CPU/memory limits in `docker-compose.yml`:

```yaml
environment:
  - JAVA_OPTS=-Xmx8g -Xms4g -Djava.awt.headless=true
```

Or in `publish/Dockerfile`:

```dockerfile
CMD ["java", "-Xms4g", "-Xmx8g", ...]
```

### Sampling Rate

Faster CPU sampling (default: ~1.25s intervals):

Edit `tests/run_load_test.sh`:
```bash
STATS_INTERVAL=0.25  # Seconds between samples
```

**Note:** `docker stats` has ~1s overhead, limiting effective sampling rate.

---

## 🐛 Troubleshooting

### AEM won't start

```bash
# Check logs
docker-compose logs aem-publish

# Common issues:
# - Missing license.properties
# - Wrong JAR file name
# - Insufficient memory (needs 8GB+)
```

### "Dockerfile not found"

Ensure you're running from project root:
```bash
docker-compose build ./publish
```

### High CPU but low throughput

This is normal for **cold JVM** (< 5 minutes warm-up). The JIT compiler needs time to optimize hot paths. Run longer tests (12+ minutes) for accurate results.

### Permission errors (macOS)

```bash
# Fix mounted volume permissions
chmod -R 777 ./publish/crx-quickstart
xattr -cr ./publish/crx-quickstart  # Remove extended attributes
```

---

## 📈 Production Capacity Estimation

Use the inflection point to estimate production capacity:

1. Find VU count where **latency starts degrading**
2. Note **CPU %** at that point
3. Calculate: `Production VUs ≈ (Prod CPUs / Local CPUs) × Local VUs`

**Example:**
- Local test: 500 VUs @ 120% CPU (1.2 cores) on 16-core machine
- Production: 32 cores available
- Estimate: `(32 / 16) × 500 = 1000 VUs`

⚠️ **This is a rough estimate.** Real production testing is essential due to:
- Network latency
- Database performance
- Disk I/O
- Caching behavior
- JVM tuning differences

---

## 🧹 Cleanup

```bash
# Stop and remove containers
docker-compose down

# Remove volumes (⚠️ deletes AEM data)
docker-compose down -v

# Clean test results
cd tests
rm -f k6-results.json docker-stats.json *.png test-environment.json
```

---

## 📝 Notes

- **JVM Warm-up:** Allow 5-10 minutes at moderate load before peak testing
- **macOS Docker:** ~20-30% overhead vs Linux due to virtualization
- **Sampling gaps:** Brief CPU spikes (< 1s) may not be captured
- **First run:** AEM unpacks to `crx-quickstart/` (~2GB), subsequent starts are faster

---

## 🤝 Contributing

This is an internal testing framework. Customize for your needs:

- Add custom k6 test scenarios in `tests/`
- Modify ramp-up profiles for different load patterns
- Extend `plot_k6_results.js` for additional metrics

---

## ⚖️ License

Adobe Experience Manager is proprietary software. This testing framework is for **internal use only** with valid AEM licenses.

---

## 📚 References

- [k6 Documentation](https://k6.io/docs/)
- [Docker Compose Reference](https://docs.docker.com/compose/)
- [AEM Performance Tuning](https://experienceleague.adobe.com/docs/experience-manager-65/deploying/configuring/configuring-performance.html)
