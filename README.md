# ⚡ Secure Multi-Language Code Execution Engine

A sandboxed remote code execution (RCE) microservice built with **Node.js**, **Express**, and **Docker**. Designed to safely execute untrusted user code in 13 languages.

---

## 🚀 Features

- **Multi-Language Support:** Python, JavaScript, C, C++, Rust, Go, Java, C#, Ruby, PHP, Erlang, Kotlin, TypeScript
- **Sandboxed Execution:** Ephemeral Docker containers with no network access and strict resource limits
- **Counter-based Concurrency Control:** Limits active jobs to prevent CPU starvation
- **Rate Limiting:** IP-based fixed-window limiting to mitigate DoS attacks
- **Resource Isolation:** Memory (256MB), CPU (0.5 cores), and PID limits per container

---

## ⚠️ Performance Notes

This service is designed for lightweight infrastructure (e.g., t3.micro). Compiled languages have significant cold-start overhead due to container compilation.

| Language | Typical Time |
|----------|--------------|
| Python, JavaScript, Ruby, PHP | 1-3s |
| C, C++ | 3-5s |
| Java, Erlang | 5-10s |
| TypeScript | 5-10s |
| Go, Rust, Kotlin, C# | 30-60s |

---

## 🛠 Architecture

The system uses a **Producer-Consumer** model where the Express API accepts jobs and spawns isolated Docker containers for execution.

```
┌──────────────┐      ┌──────────────┐      ┌──────────────────┐
│    User      │─────▶│  Cloudflare  │─────▶│   Express API    │
└──────────────┘      └──────────────┘      └────────┬─────────┘
                                                     │
                                            ┌────────▼─────────┐
                                            │   Rate Limiter   │
                                            │  (10 req/min/IP) │
                                            └────────┬─────────┘
                                                     │
                                            ┌────────▼─────────┐
                                            │ Concurrency Gate │
                                            │   (max 2 jobs)   │
                                            └────────┬─────────┘
                                                     │
                                            ┌────────▼─────────┐
                                            │ Docker Container │
                                            │  --network none  │
                                            │  --memory 256m   │
                                            │  --cpus 0.5      │
                                            └────────┬─────────┘
                                                     │
                                            ┌────────▼─────────┐
                                            │  stdout/stderr   │
                                            └──────────────────┘
```

---

## 🔒 Security Defenses

Running untrusted code is dangerous. This engine implements **Defense-in-Depth**:

1. **Network Isolation:** Containers run with `--network none`. No outbound connections possible.
2. **Fork Bomb Protection:** `--pids-limit 256` prevents malicious process spawning.
3. **Memory Limits:** `--memory 256m` prevents memory exhaustion attacks.
4. **CPU Limits:** `--cpus 0.5` prevents CPU starvation of the host.
5. **Timeouts:** Per-language execution limits (12-60 seconds) enforced by Node.js.
6. **Ephemeral Filesystem:** Code is written to a unique `/tmp/<uuid>/` directory and wiped immediately after execution.
7. **No Persistent State:** Containers are removed (`--rm`) after each execution.

---

## 📡 API Reference

### `POST /execute`

Executes a snippet of code in the specified language.

**Request Body:**

```json
{
  "language": "python",
  "code": "print('Hello from the sandbox!')"
}
```

**Supported Languages:**

`python`, `javascript`, `c`, `cpp`, `rust`, `go`, `java`, `csharp`, `ruby`, `php`, `erlang`, `kotlin`, `typescript`

**Response (Success - 200):**

```json
{
  "stdout": "Hello from the sandbox!\n",
  "stderr": ""
}
```

**Response (Timeout - 200):**

```json
{
  "error": "Time Limit Exceeded"
}
```

**Response (Rate Limited - 429):**

```json
{
  "error": "Rate limit exceeded. Wait 1 min."
}
```

**Response (Server Busy - 503):**

```json
{
  "error": "Server busy."
}
```

---

## 💻 Local Setup

### Prerequisites

- Node.js v18+
- Docker (running and accessible by current user)

### 1. Clone & Install

```bash
git clone https://github.com/CharlesBai-blc/toolbox-executor.git
cd toolbox-executor
npm install
```

### 2. Pull Docker Images

Pre-pull images to avoid timeouts on first run:

```bash
# Interpreted languages
docker pull python:3.11-alpine
docker pull node:18-alpine
docker pull ruby:3.2-alpine
docker pull php:8.2-cli-alpine
docker pull erlang:26-alpine

# Compiled languages
docker pull golang:1.23-alpine
docker pull rust:1.83-alpine
docker pull gcc:12
docker pull amazoncorretto:17-alpine
docker pull mcr.microsoft.com/dotnet/sdk:8.0-alpine
```

### 3. Build Custom Images

TypeScript and Kotlin require custom images:

```bash
# TypeScript
docker build -t typescript:alpine -<<'EOF'
FROM node:18-alpine
RUN npm install -g typescript ts-node
EOF

# Kotlin
docker build -t kotlin:alpine -<<'EOF'
FROM amazoncorretto:17-alpine
RUN apk add --no-cache bash wget unzip
RUN wget -q https://github.com/JetBrains/kotlin/releases/download/v1.9.22/kotlin-compiler-1.9.22.zip && \
    unzip kotlin-compiler-*.zip -d /opt && \
    rm kotlin-compiler-*.zip
ENV PATH=$PATH:/opt/kotlinc/bin
EOF
```

### 4. Configure Environment

```bash
cp .env.example .env
# Edit .env with your settings:
# PORT=3000
# FRONTEND_URL=http://localhost:5173
```

### 5. Run Development Server

```bash
npm start
# Server running on http://localhost:3000
```

### 6. Test

```bash
curl -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"language": "python", "code": "print(100 * 5)"}'
```

---

## ☁️ Deployment

### Production Checklist

1. **Trust Proxy:** Ensure `app.set('trust proxy', 1)` is enabled if behind a load balancer/CDN.

2. **Docker Permissions:** Add your user to the docker group:
   ```bash
   sudo usermod -aG docker $USER
   newgrp docker
   ```

3. **Process Management:** Use PM2 for automatic restarts:
   ```bash
   npm install -g pm2
   pm2 start server.js --name executor
   pm2 save
   pm2 startup
   ```

4. **Pre-pull Images:** Ensure all Docker images are pulled before going live to avoid cold-start timeouts.

---

## 📊 Resource Requirements

| Setup | vCPU | RAM | Notes |
|-------|------|-----|-------|
| Minimum | 1 | 1 GB | Interpreted languages only, slow compiled |
| Recommended | 2 | 2 GB | All languages, compiled still slow |
| Optimal | 4 | 4 GB | Reasonable compiled language performance |

---

## License

MIT
