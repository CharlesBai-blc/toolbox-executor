require('dotenv').config({ path: '/home/ubuntu/executor/src/.env' });
const express = require('express');
const { exec } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

const app = express();

app.set('trust proxy', 1);
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173'
}));
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Rate Limiting (10 reqs/min per IP)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Rate limit exceeded. Wait 1 min." }
});

// Concurrency Queue (Max 2 simultaneous jobs)
let activeJobs = 0;
const MAX_CONCURRENT_JOBS = 2;

// --- LANGUAGE CONFIGURATION ---
const LANGUAGES = {
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
    runCmd: (file) => `env CGO_ENABLED=0 go run ${file}`
  },
  java: {
    image: 'amazoncorretto:17-alpine',
    filename: 'Main.java', 
    runCmd: (file) => `java ${file}` 
  },
  ruby: {
    image: 'ruby:3.2-alpine',
    filename: 'main.rb',
    runCmd: (file) => `ruby ${file}`
  },
  php: {
    image: 'php:8.2-cli-alpine',
    filename: 'main.php',
    runCmd: (file) => `php ${file}`
  },
  erlang: {
    image: 'erlang:26-alpine',
    filename: 'main.erl',
    runCmd: (file) => `escript ${file}`
  },
  csharp: {
    image: 'mcr.microsoft.com/dotnet/sdk:8.0-alpine',
    filename: 'Program.cs',
    // Scaffolds a console app in /tmp, moves the user file there, and runs it
    runCmd: (file) => `/bin/sh -c "dotnet new console -o /tmp/app > /dev/null && cp ${file} /tmp/app/Program.cs && dotnet run --project /tmp/app"`
  },
  typescript: {
    image: 'typescript:alpine', // Custom built image
    filename: 'main.ts',
    runCmd: (file) => `ts-node ${file}`
  },
  kotlin: {
    image: 'kotlin:alpine', // Custom built image
    filename: 'Main.kt',
    // Compiles to jar in /tmp, then runs the jar
    runCmd: (file) => `/bin/sh -c "kotlinc ${file} -include-runtime -d /tmp/out.jar && java -jar /tmp/out.jar"`
  }
};

app.post('/execute', limiter, async (req, res) => {
  const { code, language } = req.body;

  if (!LANGUAGES[language]) return res.status(400).json({ error: "Unsupported language" });
  if (activeJobs >= MAX_CONCURRENT_JOBS) return res.status(503).json({ error: "Server busy." });

  const jobID = uuidv4();
  const config = LANGUAGES[language];

  const hostDir = path.join('/tmp', jobID);
  const hostFile = path.join(hostDir, config.filename);

  try {
    activeJobs++; // LOCK

    // Create a unique directory for this job
    await fs.mkdir(hostDir);
    await fs.writeFile(hostFile, code);

    // DOCKER SECURITY FLAGS:
    const dockerCmd = `docker run --rm \
      --network none \
      --memory 256m \
      --cpus 0.5 \
      --pids-limit 256 \
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

app.listen(PORT, () => console.log(`Executor running on port ${PORT}`));
