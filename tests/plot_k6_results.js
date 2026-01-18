import fs from 'node:fs';
import readline from 'node:readline';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';

const width = 1400;
const height = 800;

// ══════════════════════════════════════════════════════════════════
// Load Environment Metadata
// ══════════════════════════════════════════════════════════════════
let envInfo = null;
try {
    envInfo = JSON.parse(fs.readFileSync('test-environment.json', 'utf8'));
    console.log('📋 Loaded environment metadata');
} catch (e) {
    console.log('⚠️  No test-environment.json found - running without env metadata');
}

function buildSubtitle() {
    if (!envInfo) return ['Environment details not captured'];
    
    const lines = [];
    lines.push(
        `Host: ${envInfo.host.os} ${envInfo.host.arch} | ` +
        `${envInfo.host.cpus} CPUs | ${envInfo.host.memory} RAM`
    );
    lines.push(
        `Container: ${envInfo.container.name} (${envInfo.container.image}) | ` +
        `CPU: ${envInfo.container.cpuLimit} | Memory: ${envInfo.container.memLimit}`
    );
    lines.push(
        `Java: ${envInfo.versions.java} | Docker: ${envInfo.versions.docker} | ` +
        `Test: ${envInfo.testDateLocal}`
    );
    return lines;
}

// ══════════════════════════════════════════════════════════════════
// Stream-based k6 Results Parser (handles large files)
// ══════════════════════════════════════════════════════════════════
async function parseK6Results(filename) {
    const groupLatency = {};
    const groupVus = {};
    let lineCount = 0;
    
    const fileStream = fs.createReadStream(filename);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });
    
    console.log('📊 Streaming k6 results (this may take a moment for large files)...');
    
    for await (const line of rl) {
        if (!line.trim()) continue;
        lineCount++;
        
        // Progress indicator every 100k lines
        if (lineCount % 100000 === 0) {
            process.stdout.write(`   Processed ${(lineCount / 1000).toFixed(0)}k lines...\r`);
        }
        
        try {
            const point = JSON.parse(line);
            
            if (point.type !== 'Point') continue;
            
            const time = new Date(point.data.time).getTime();
            const bucket = Math.floor(time / 10000); // 10-second buckets
            
            if (point.metric === 'http_req_duration') {
                if (!groupLatency[bucket]) groupLatency[bucket] = [];
                groupLatency[bucket].push(point.data.value);
            } else if (point.metric === 'vus') {
                if (!groupVus[bucket]) groupVus[bucket] = [];
                groupVus[bucket].push(point.data.value);
            }
        } catch (e) {
            // Skip malformed lines
        }
    }
    
    console.log(`   ✓ Processed ${(lineCount / 1000).toFixed(0)}k lines total`);
    
    return { groupLatency, groupVus };
}

// ══════════════════════════════════════════════════════════════════
// Load Docker Stats (usually small enough to fit in memory)
// ══════════════════════════════════════════════════════════════════
function loadDockerStats() {
    const groupCpu = {};
    const allRawCpu = [];  // Store ALL raw CPU values for accurate stats
    
    try {
        const lines = fs.readFileSync('docker-stats.json', 'utf8').split('\n');
        let count = 0;
        
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const parsed = JSON.parse(line);
                const time = new Date(parsed.time).getTime();
                const bucket = Math.floor(time / 10000);
                const cpu = parseFloat(parsed.cpu.replace('%', ''));
                
                if (!groupCpu[bucket]) groupCpu[bucket] = [];
                groupCpu[bucket].push(cpu);
                allRawCpu.push(cpu);  // Track raw value
                count++;
            } catch (e) {}
        }
        
        console.log(`📦 Loaded ${count} docker stats data points`);
        return { groupCpu, allRawCpu };
    } catch (e) {
        console.log('⚠️  No docker-stats.json found - CPU data will be skipped');
        return { groupCpu: {}, allRawCpu: [] };
    }
}

// ══════════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════════
async function main() {
    // Parse data
    const { groupLatency, groupVus } = await parseK6Results('k6-results.json');
    const { groupCpu, allRawCpu } = loadDockerStats();
    
    // Get all unique time buckets and sort
    const allBuckets = [...new Set([
        ...Object.keys(groupLatency), 
        ...Object.keys(groupVus),
        ...Object.keys(groupCpu)
    ])].sort((a, b) => a - b);
    
    console.log(`📈 ${allBuckets.length} time buckets to chart`);
    
    const labels = allBuckets.map(k => {
        const date = new Date(parseInt(k) * 10000);
        return date.toLocaleTimeString();
    });
    
    // Calculate P95 latency for each bucket
    const p95Latency = allBuckets.map(bucket => {
        const values = groupLatency[bucket];
        if (!values || values.length === 0) return null;
        const sorted = [...values].sort((a, b) => a - b);
        const p95Index = Math.floor(sorted.length * 0.95);
        return sorted[p95Index] || sorted[sorted.length - 1];
    });
    
    // Get max VUs for each bucket
    const vusValues = allBuckets.map(bucket => {
        const values = groupVus[bucket];
        if (!values || values.length === 0) return null;
        return Math.max(...values);
    });
    
    // Get MAX CPU for each bucket (not average - we want to see peaks!)
    const cpuValues = allBuckets.map(bucket => {
        const values = groupCpu[bucket];
        if (!values || values.length === 0) return null;
        return Math.max(...values);
    });
    
    const hasCpuData = cpuValues.some(v => v !== null);
    
    // ══════════════════════════════════════════════════════════════════
    // Calculate Summary Statistics
    // ══════════════════════════════════════════════════════════════════
    const validVus = vusValues.filter(v => v !== null);
    const validLatency = p95Latency.filter(v => v !== null);
    const validCpu = cpuValues.filter(v => v !== null);
    
    // Use RAW CPU values for accurate stats (not bucketed averages)
    const stats = {
        maxVus: validVus.length ? Math.max(...validVus) : 0,
        avgLatency: validLatency.length ? (validLatency.reduce((a, b) => a + b, 0) / validLatency.length) : 0,
        maxLatency: validLatency.length ? Math.max(...validLatency) : 0,
        minLatency: validLatency.length ? Math.min(...validLatency) : 0,
        avgCpu: allRawCpu.length ? (allRawCpu.reduce((a, b) => a + b, 0) / allRawCpu.length) : 0,
        maxCpu: allRawCpu.length ? Math.max(...allRawCpu) : 0,
        minCpu: allRawCpu.length ? Math.min(...allRawCpu) : 0,
    };
    
    // ══════════════════════════════════════════════════════════════════
    // Build Chart Configuration
    // ══════════════════════════════════════════════════════════════════
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });
    
    const datasets = [
        {
            label: 'Concurrent Users (VUs)',
            data: vusValues,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.15)',
            fill: true,
            tension: 0.3,
            yAxisID: 'y-vus',
            pointRadius: 1,
            borderWidth: 2
        },
        {
            label: 'Response Time P95 (ms)',
            data: p95Latency,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            fill: false,
            tension: 0.3,
            yAxisID: 'y-latency',
            pointRadius: 1,
            borderWidth: 2
        }
    ];
    
    if (hasCpuData) {
        datasets.push({
            label: 'Container CPU %',
            data: cpuValues,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            fill: false,
            tension: 0.3,
            yAxisID: 'y-cpu',
            pointRadius: 1,
            borderWidth: 2,
            borderDash: [5, 5]
        });
    }
    
    const scales = {
        'y-vus': {
            type: 'linear',
            position: 'left',
            beginAtZero: true,
            title: { 
                display: true, 
                text: 'Concurrent Users',
                color: '#f59e0b',
                font: { weight: 'bold' }
            },
            ticks: { color: '#f59e0b' },
            grid: { drawOnChartArea: false }
        },
        'y-latency': {
            type: 'linear',
            position: 'right',
            beginAtZero: true,
            title: { 
                display: true, 
                text: 'Response Time (ms)',
                color: '#3b82f6',
                font: { weight: 'bold' }
            },
            ticks: { color: '#3b82f6' },
            grid: { drawOnChartArea: true }
        },
        x: { 
            title: { display: true, text: 'Test Time' },
            ticks: { maxTicksLimit: 25 }
        }
    };
    
    if (hasCpuData) {
        // CPU % can exceed 100% on multi-core systems (100% = 1 full core)
        const maxCpuObserved = Math.max(...cpuValues.filter(v => v !== null));
        scales['y-cpu'] = {
            type: 'linear',
            position: 'right',
            beginAtZero: true,
            max: Math.ceil(maxCpuObserved / 100) * 100 + 50, // Round up to nearest 100 + buffer
            title: { 
                display: true, 
                text: 'CPU % (100% = 1 core)',
                color: '#ef4444',
                font: { weight: 'bold' }
            },
            ticks: { color: '#ef4444' },
            grid: { drawOnChartArea: false }
        };
    }
    
    const configuration = {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                title: { 
                    display: true, 
                    text: 'k6 Load Test Analysis',
                    font: { size: 20, weight: 'bold' },
                    padding: { bottom: 5 }
                },
                subtitle: {
                    display: true,
                    text: buildSubtitle(),
                    font: { size: 11 },
                    color: '#666',
                    padding: { bottom: 15 }
                },
                legend: {
                    position: 'top',
                    labels: { usePointStyle: true }
                }
            },
            scales
        }
    };
    
    // ══════════════════════════════════════════════════════════════════
    // Generate Chart and Summary
    // ══════════════════════════════════════════════════════════════════
    console.log('🎨 Rendering chart...');
    const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);
    const filename = 'k6-load-test-analysis.png';
    fs.writeFileSync(filename, imageBuffer);
    
    console.log(`\n✅ Chart saved as ${filename}`);
    console.log(`   📊 Data points: ${allBuckets.length} time buckets\n`);
    
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    TEST SUMMARY                              ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  👥 Max Concurrent Users:    ${String(stats.maxVus).padStart(6)}                       ║`);
    console.log('╠──────────────────────────────────────────────────────────────╣');
    console.log('║  📊 RESPONSE TIME (P95):                                     ║');
    console.log(`║     Min: ${String(stats.minLatency.toFixed(1)).padStart(8)} ms                                    ║`);
    console.log(`║     Avg: ${String(stats.avgLatency.toFixed(1)).padStart(8)} ms                                    ║`);
    console.log(`║     Max: ${String(stats.maxLatency.toFixed(1)).padStart(8)} ms                                    ║`);
    if (hasCpuData) {
        const hostCpus = envInfo?.host?.cpus || 1;
        const maxCpuCores = (stats.maxCpu / 100).toFixed(1);
        const avgCpuCores = (stats.avgCpu / 100).toFixed(1);
        const minCpuCores = (stats.minCpu / 100).toFixed(1);
        console.log('╠──────────────────────────────────────────────────────────────╣');
        console.log('║  🔥 CPU UTILIZATION:                                         ║');
        console.log(`║     Min: ${String(stats.minCpu.toFixed(1)).padStart(8)} % (${minCpuCores} cores)                       ║`);
        console.log(`║     Avg: ${String(stats.avgCpu.toFixed(1)).padStart(8)} % (${avgCpuCores} cores)                       ║`);
        console.log(`║     Max: ${String(stats.maxCpu.toFixed(1)).padStart(8)} % (${maxCpuCores} of ${hostCpus} cores)              ║`);
    }
    console.log('╚══════════════════════════════════════════════════════════════╝');
    
    // Production correlation guidance
    console.log('\n📈 PRODUCTION CORRELATION NOTES:');
    console.log('─────────────────────────────────────────────────────────────────');
    if (envInfo) {
        console.log(`   Local:  ${envInfo.host.cpus} CPUs, ${envInfo.host.memory} RAM`);
        console.log(`           Container limits: CPU=${envInfo.container.cpuLimit}, Mem=${envInfo.container.memLimit}`);
    }
    console.log('');
    console.log('   To estimate production capacity:');
    console.log('   1. Find the VU count where latency starts degrading (inflection point)');
    console.log('   2. Note the CPU % at that point - this is your "capacity threshold"');
    console.log('   3. Production capacity ≈ (Prod CPUs / Local CPUs) × Local VUs at threshold');
    console.log('');
    console.log('   ⚠️  This is a rough estimate. Real production testing is essential.');
    console.log('   Factors not captured: network latency, disk I/O, JVM tuning, caching, etc.');
    console.log('');
}

main().catch(console.error);
