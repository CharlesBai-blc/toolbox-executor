const express = require('express');
const { exec } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

const app = express();

// SECURITY LAYER: Trust Cloudflare headers
app.set('trust proxy', 1);

// SECURITY LAYER: CORS restricted to your frontend
app.use(cors({
  origin: 'https://toolbox.charles-bai.com'
}));
app.use(express.json());

// SECURITY LAYER 2: Rate Limiting (10 reqs/min per IP)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Rate limit exceeded. Wait 1 min." }
});

// SECURITY LAYER 3: Concurrency Queue (Max 2 simultaneous jobs)
let activeJobs = 0;
const MAX_CONCURRENT_JOBS = 2;

// --- LANGUAGE CONFIGURATION ---
const LANGUAGES = {
  // Interpreted Languages (Simple)
  python: {
    image: 'python:3.11-alpine',
    filename: 'main.py',
    runCmd: (file) => `python ${file}`
  },
  javascript: {
    image: 'node:18-alpine',
    filename: 'main.js',
    runCmd: (file) => `node ${file}`
  },

  // Compiled Languages (Complex)
  // We use /bin/sh -c to chain compilation and execution
  c: {
    image: 'gcc:12',
    filename: 'main.c',
    runCmd: (file) => `/bin/sh -c "gcc ${file} -o /tmp/out && /tmp/out"`
  },
  cpp: {
    image: 'gcc:12',
    filename: 'main.cpp',
    runCmd: (file) => `/bin/sh -c "g++ ${file} -o /tmp/out && /tmp/out"`
  },
  rust: {
    image: 'rust:1.83-alpine',
    filename: 'main.rs',
    runCmd: (file) => `/bin/sh -c "rustc ${file} -o /tmp/out && /tmp/out"`
  },
  go: {
    image: 'golang:1.23-alpine',
    filename: 'main.go',
    runCmd: (file) => `go run ${file}`
  },
  java: {
    image: 'amazoncorretto:17-alpine',
    filename: 'Main.java', // Java requires class name matching
    runCmd: (file) => `java ${file}` // Java 11+ supports running source directly
  },
};

app.post('/execute', limiter, async (req, res) => {
  const { code, language } = req.body;

  if (!LANGUAGES[language]) return res.status(400).json({ error: "Unsupported language" });
  if (activeJobs >= MAX_CONCURRENT_JOBS) return res.status(503).json({ error: "Server busy." });

  const jobID = uuidv4();
  const config = LANGUAGES[language];

  // We rename the file inside the container to a standard name (e.g., Main.java)
  // but keep it unique on the host (/tmp/uuid/Main.java) to prevent conflicts.
  const hostDir = path.join('/tmp', jobID);
  const hostFile = path.join(hostDir, config.filename);

  try {
    activeJobs++; // LOCK

    // Create a unique directory for this job (critical for Java/Rust file naming)
    await fs.mkdir(hostDir);
    await fs.writeFile(hostFile, code);

    // DOCKER SECURITY FLAGS:
    // --network none: No internet
    // --pids-limit 64: No fork bombs
    // --memory 256m: Increased for compilation
    // -v: Mount host dir to /app container dir
    const dockerCmd = `docker run --rm \
      --network none \
      --memory 256m \
      --cpus 0.5 \
      --pids-limit 64 \
      -v ${hostDir}:/app:rw \
      -w /app \
      ${config.image} \
      ${config.runCmd(config.filename)}`;

    await new Promise((resolve) => {
      exec(dockerCmd, { timeout: 5000 }, (error, stdout, stderr) => {
        // Cleanup unique directory
        fs.rm(hostDir, { recursive: true, force: true }).catch(() => {});

        if (error && error.killed) res.json({ error: "Time Limit Exceeded" });
        else res.json({ stdout, stderr: stderr || (error ? error.message : "") });

        resolve();
      });
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server Error" });
  } finally {
    activeJobs--; // RELEASE LOCK
  }
});

app.listen(3000, () => console.log('Multi-Language Executor running on port 3000'));
