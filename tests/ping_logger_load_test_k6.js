import http from 'k6/http';
import { check, sleep } from 'k6';

// ---------- Load Profile ----------
// Aggressive ramp-up to find breaking point
// Adjust based on your machine's capacity
export const options = {
  stages: [
    // Warm-up phase (JVM needs time to JIT compile)
    { duration: '1m', target: 50 },
    // Gradual ramp-up to find inflection point
    { duration: '2m', target: 100 },
    { duration: '2m', target: 250 },
    { duration: '2m', target: 500 },
    // Push limits (fully warmed JVM = higher CPU utilization)
    { duration: '2m', target: 750 },
    { duration: '2m', target: 1000 },
    // Cool-down
    { duration: '1m', target: 0 },
  ],
  // Total: ~12 minutes
  thresholds: {
    http_req_failed: ['rate<0.05'],        // <5% errors (relaxed for stress test)
    http_req_duration: ['p(95)<5000'],     // p95 < 5s (relaxed for stress test)
  },
  // Prevent k6 from running out of resources
  noConnectionReuse: false,
  userAgent: 'k6-load-test/1.0',
};

// ---------- Constants ----------
const URL = 'http://localhost:4503/content/pingLogger.json';

const HEADERS = {
  'Content-Type': 'application/json',
};

// ---------- Payload ----------
const payload = JSON.stringify({
  requestString: {
    customerName: 'John Doe',
    mobileNumber: '9876543210',
    emailAddress: 'john.doe@example.com',
    address: '123 Main Street, City',
    dateOfBirth: '1990-01-15',
    panNumber: 'ABCDE1234F',
  },
});

// ---------- Test ----------
export default function () {
  const res = http.post(URL, payload, { headers: HEADERS });

  check(res, {
    'status is 200': (r) => r.status === 200,
  });

  // Small sleep prevents unrealistically tight loops
  sleep(0.2);
}

