# CodeMesh

### Real-Time Collaborative Coding Platform

Codivio is a real-time collaborative coding platform that allows multiple developers to work on the same codebase simultaneously. Users can create or join coding rooms, edit code together in real time, see other collaborators' changes, and execute code inside isolated Docker environments.

The platform is designed around real-time synchronization, collaborative editing, and secure code execution.

---

## ✨ Features

* 👥 **Real-Time Collaboration** — Multiple users can edit the same code simultaneously.
* ⚡ **Real-Time Synchronization** — Code changes are synchronized instantly between connected users.
* 🖱️ **Collaborative Cursors** — See where other users are currently editing.
* 🏠 **Coding Rooms** — Create and join isolated collaborative coding sessions.
* 💻 **Monaco Editor** — VS Code-like coding experience directly in the browser.
* ▶️ **Code Execution** — Compile and execute submitted code through the backend.
* 🐳 **Docker Sandboxing** — User code runs inside isolated Docker containers.
* ⏱️ **Execution Limits** — Prevent runaway programs from consuming server resources.
* 📟 **Integrated Terminal** — Display program output and compilation/runtime errors.
* 🔄 **Reconnection Support** — Recover collaboration sessions when users temporarily disconnect.
* 🔐 **Authentication & Authorization** — Secure access to users and coding rooms.
* 📁 **Project/File Management** — Organize code using multiple files.
* 💾 **Code Persistence** — Save collaborative projects and their state.

---

# 🏗️ System Architecture

```text
                         ┌─────────────────────┐
                         │      Browser        │
                         │                     │
                         │ React + Monaco      │
                         │ Yjs / y-monaco      │
                         └──────────┬──────────┘
                                    │
                              HTTPS / WebSocket
                                    │
                                    ▼
                    ┌─────────────────────────────┐
                    │       AWS Infrastructure    │
                    │                             │
                    │  ┌───────────────────────┐  │
                    │  │   Frontend Container   │  │
                    │  │   React + Nginx        │  │
                    │  └───────────┬───────────┘  │
                    │              │              │
                    │  ┌───────────▼───────────┐  │
                    │  │   Backend Container   │  │
                    │  │ Express + Socket.IO   │  │
                    │  └───────────┬───────────┘  │
                    │              │              │
                    └──────────────┼──────────────┘
                                   │
                            Execution Request
                                   │
                                   ▼
                       ┌────────────────────────┐
                       │   Execution Service    │
                       │                        │
                       │   Docker Sandbox       │
                       │                        │
                       │  ┌──────────────────┐  │
                       │  │ Isolated Runtime │  │
                       │  │                  │  │
                       │  │ g++ / Node /     │  │
                       │  │ Python / Java    │  │
                       │  └──────────────────┘  │
                       └───────────┬────────────┘
                                   │
                              stdout / stderr
                                   │
                                   ▼
                         ┌────────────────────┐
                         │   React Terminal   │
                         │                    │
                         │ Output / Errors    │
                         └────────────────────┘
```

---

# 🔄 How Collaboration Works

Codivio uses WebSockets for real-time communication between clients and the backend.

The collaborative editing layer uses **Yjs** to maintain a shared document state.

```text
User A ─────┐
            │
User B ─────┼──► Socket.IO ──► Yjs Shared Document
            │                         │
User C ─────┘                         │
                                      ▼
                              Synchronized State
                                      │
                         ┌────────────┼────────────┐
                         ▼            ▼            ▼
                      User A       User B       User C
```

When a user makes an edit:

1. Monaco Editor detects the change.
2. Yjs updates the shared document.
3. The change is propagated through the WebSocket connection.
4. Other connected clients receive the update.
5. Their editors update without requiring a page refresh.

This allows multiple users to work on the same code simultaneously.

---

# ▶️ Code Execution

Code execution is separated from the main application server.

```text
Client
   │
   │ Code + Language
   ▼
Backend API
   │
   ▼
Execution Service
   │
   ▼
Docker Container
   │
   ├── Create temporary source file
   ├── Compile
   ├── Execute
   ├── Capture stdout/stderr
   └── Destroy container
   │
   ▼
Execution Result
   │
   ▼
Client Terminal
```

User-submitted code is **not executed directly on the Node.js application process**.

Instead, each execution is performed inside an isolated Docker environment with resource restrictions such as:

* CPU limits
* Memory limits
* Execution timeout
* Temporary filesystem
* Restricted permissions
* Network restrictions where applicable

After execution completes, the temporary execution environment is removed.

---

# 🧰 Tech Stack

## Frontend

* React.js
* Monaco Editor
* Yjs
* y-monaco
* Socket.IO Client
* HTML5
* CSS3

## Backend

* Node.js
* Express.js
* Socket.IO
* Yjs
* REST APIs

## Database & Infrastructure

* MongoDB
* Redis
* Docker
* AWS
* Nginx

## Code Execution

* Docker Sandbox
* C++ / g++
* Additional language runtimes as supported

---

# ☁️ AWS Deployment

The application is containerized using Docker and deployed on AWS.

A production deployment can be structured as:

```text
                         Internet
                            │
                            ▼
                    AWS Load Balancer
                       /          \
                      /            \
                     ▼              ▼
             Frontend             Backend
             Container            Container
                 │                    │
              Nginx              Node.js
                                      │
                         ┌────────────┼────────────┐
                         ▼            ▼            ▼
                     MongoDB       Redis       Executor
                                                 │
                                                 ▼
                                          Docker Sandbox
```

Docker provides consistent environments between local development and production.

---

# 📂 Project Structure

```text
codivio/
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── services/
│   │   └── App.jsx
│   │
│   ├── Dockerfile
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── sockets/
│   │   ├── models/
│   │   └── utils/
│   │
│   ├── Dockerfile
│   └── package.json
│
├── executor/
│   ├── Dockerfile
│   └── ...
│
├── docker-compose.yml
├── .gitignore
└── README.md
```

---

# 🚀 Getting Started

## Prerequisites

Make sure you have installed:

* Node.js
* npm
* Docker
* MongoDB
* Git

Clone the repository:

```bash
git clone https://github.com/<your-username>/codivio.git

cd codivio
```

---

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The frontend will start on the configured development port.

---

## Backend Setup

```bash
cd backend
npm install
npm run dev
```

Create a `.env` file:

```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
CLIENT_URL=http://localhost:5173
REDIS_URL=your_redis_url
```

---

# 🐳 Docker Setup

Build the application containers:

```bash
docker compose build
```

Start the services:

```bash
docker compose up
```

Stop the services:

```bash
docker compose down
```

---

# 🔐 Security Considerations

Running arbitrary code is one of the most security-sensitive parts of the platform.

Codivio isolates code execution from the application server.

The execution environment should enforce:

```text
CPU Limit
Memory Limit
Execution Timeout
Process Limit
Filesystem Restrictions
Network Restrictions
Non-root Execution
Temporary Environment
```

The application server should never trust user-submitted code.

---

# 📈 Scalability

The initial version can run with a single backend instance.

For scaling to multiple backend instances:

```text
                    Load Balancer
                    /     |     \
                   ▼      ▼      ▼
              Server 1 Server 2 Server 3
                   \      |      /
                    \     |     /
                     ▼    ▼    ▼
                    Redis Pub/Sub
```

Redis can be used for cross-instance communication and Socket.IO scaling.

The execution layer can also be separated from the main backend:

```text
API Server
    │
    ▼
Job Queue
    │
    ▼
Execution Workers
    │
    ├── Worker 1 → Docker
    ├── Worker 2 → Docker
    └── Worker 3 → Docker
```

This prevents code execution workloads from blocking normal API and WebSocket operations.

---

# 🛣️ Roadmap

### Phase 1 — Core Editor

* [x] React application
* [x] Monaco Editor
* [ ] User authentication
* [ ] Coding rooms
* [ ] Basic code persistence

### Phase 2 — Collaboration

* [ ] Socket.IO integration
* [ ] Yjs integration
* [ ] Real-time document synchronization
* [ ] Collaborative cursors
* [ ] User presence
* [ ] Reconnection handling

### Phase 3 — Code Execution

* [ ] C++ execution
* [ ] Docker sandbox
* [ ] Execution timeout
* [ ] Memory/CPU restrictions
* [ ] Compilation error handling
* [ ] Runtime error handling
* [ ] Multiple languages

### Phase 4 — Production Infrastructure

* [ ] Dockerized frontend
* [ ] Dockerized backend
* [ ] AWS deployment
* [ ] Redis
* [ ] Load balancing
* [ ] Execution workers
* [ ] Monitoring/logging

### Phase 5 — Advanced Features

* [ ] File explorer
* [ ] Version history
* [ ] Project sharing
* [ ] Role-based permissions
* [ ] Integrated chat
* [ ] GitHub integration
* [ ] AI coding assistant
* [ ] Collaborative interview mode

---

# 🎯 Projec
