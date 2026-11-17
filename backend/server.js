import express from "express"
import { createServer } from "http"
import { Server } from "socket.io"
import { YSocketIO } from "y-socket.io/dist/server"
import cors from "cors"
import { exec } from "child_process"
import fs from "fs"
import path from "path"

const app = express()
const httpServer = createServer(app)

// Middleware
app.use(cors())
app.use(express.static("public"))
app.use(express.json())

const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    }
})

const ySocketIO = new YSocketIO(io)
ySocketIO.initialize()

// Active Rooms Registry (Map: roomId -> Set of socketIds)
const activeRooms = new Map()

// API: Create New Room
app.post('/api/rooms/create', (req, res) => {
    const { roomId } = req.body || {}
    if (!roomId) {
        return res.status(400).json({ error: "Room ID is required" })
    }
    if (!activeRooms.has(roomId)) {
        activeRooms.set(roomId, new Set())
    }
    console.log(`[ROOM CREATED] Active Room Code: ${roomId}`)
    return res.json({ success: true, roomId })
})

// API: Validate Room Code Before Joining
app.post('/api/rooms/validate', (req, res) => {
    const { roomId } = req.body || {}
    if (!roomId) {
        return res.status(400).json({ valid: false, message: "Room ID is required" })
    }
    const isValid = activeRooms.has(roomId)
    return res.json({ valid: isValid })
})

// Socket Room Tracking & Auto-Teardown when empty
io.on("connection", (socket) => {
    let currentRoom = null

    socket.on("join-room-tracking", ({ roomId }) => {
        if (roomId) {
            currentRoom = roomId
            socket.join(roomId)
            if (!activeRooms.has(roomId)) {
                activeRooms.set(roomId, new Set())
            }
            activeRooms.get(roomId).add(socket.id)
            console.log(`[ROOM TRACKING] Socket ${socket.id} joined room ${roomId}. Active sockets in room: ${activeRooms.get(roomId).size}`)
        }
    })

    socket.on("disconnect", () => {
        if (currentRoom && activeRooms.has(currentRoom)) {
            const socketSet = activeRooms.get(currentRoom)
            socketSet.delete(socket.id)
            console.log(`[ROOM TRACKING] Socket ${socket.id} disconnected from ${currentRoom}. Remaining sockets: ${socketSet.size}`)
            
            // Delete room code ONLY when 0 sockets remain in the room
            if (socketSet.size === 0) {
                console.log(`[ROOM CLOSED] Room ${currentRoom} is empty (0 users). Room code deleted.`)
                activeRooms.delete(currentRoom)
            }
        }
    })
})

// Multi-Language Compilation & Execution Route
app.post('/api/compile', (req, res) => {
    try {
        const { code, language = 'cpp' } = req.body || {}

        if (!code) {
            return res.status(400).json({ error: "No code provided in request body" })
        }

        const id = Date.now() + '_' + Math.random().toString(36).substring(2, 7)
        const workDir = path.join(process.cwd(), `temp_${id}`)
        fs.mkdirSync(workDir, { recursive: true })

        const cleanup = () => {
            try {
                if (fs.existsSync(workDir)) {
                    fs.rmSync(workDir, { recursive: true, force: true })
                }
            } catch (e) {
                console.error("Cleanup error:", e)
            }
        }

        const executeProcess = (runCmd) => {
            exec(runCmd, { timeout: 7000, cwd: workDir }, (runErr, runStdout, runStderr) => {
                cleanup()

                if (runErr) {
                    if (runErr.killed) {
                        return res.json({ run: { stderr: "Time Limit Exceeded (Execution exceeded 7s limit)" } })
                    }
                    return res.json({ run: { stderr: runStderr || runErr.message } })
                }

                return res.json({ run: { stdout: runStdout || "Program executed successfully with no output." } })
            })
        }

        if (language === 'python') {
            const filePath = path.join(workDir, 'main.py')
            fs.writeFile(filePath, code, (writeErr) => {
                if (writeErr) {
                    cleanup()
                    return res.status(500).json({ error: "Failed to write Python source file" })
                }
                executeProcess(`python3 "${filePath}"`)
            })
        } else if (language === 'c') {
            const filePath = path.join(workDir, 'main.c')
            const outPath = path.join(workDir, 'main.out')
            fs.writeFile(filePath, code, (writeErr) => {
                if (writeErr) {
                    cleanup()
                    return res.status(500).json({ error: "Failed to write C source file" })
                }
                exec(`gcc -O2 "${filePath}" -o "${outPath}"`, (compileErr, stdout, stderr) => {
                    if (compileErr) {
                        cleanup()
                        return res.json({ run: { stderr: stderr || compileErr.message } })
                    }
                    executeProcess(`chmod +x "${outPath}" && "${outPath}"`)
                })
            })
        } else if (language === 'java') {
            let className = 'Main'
            const classMatch = code.match(/public\s+class\s+([A-Za-z0-9_]+)/)
            if (classMatch && classMatch[1]) {
                className = classMatch[1]
            }
            const filePath = path.join(workDir, `${className}.java`)
            fs.writeFile(filePath, code, (writeErr) => {
                if (writeErr) {
                    cleanup()
                    return res.status(500).json({ error: "Failed to write Java source file" })
                }
                exec(`javac -d "${workDir}" "${filePath}"`, (compileErr, stdout, stderr) => {
                    if (compileErr) {
                        cleanup()
                        return res.json({ run: { stderr: stderr || compileErr.message } })
                    }
                    executeProcess(`java -cp "${workDir}" "${className}"`)
                })
            })
        } else {
            // Default: C++
            const filePath = path.join(workDir, 'main.cpp')
            const outPath = path.join(workDir, 'main.out')
            fs.writeFile(filePath, code, (writeErr) => {
                if (writeErr) {
                    cleanup()
                    return res.status(500).json({ error: "Failed to write C++ source file" })
                }
                exec(`g++ -O2 -I"${process.cwd()}" "${filePath}" -o "${outPath}"`, (compileErr, stdout, stderr) => {
                    if (compileErr) {
                        cleanup()
                        return res.json({ run: { stderr: stderr || compileErr.message } })
                    }
                    executeProcess(`chmod +x "${outPath}" && "${outPath}"`)
                })
            })
        }
    } catch (err) {
        console.error("Unexpected Server Error:", err)
        return res.status(500).json({ error: "Internal Server Error" })
    }
})

// Serve React Frontend SPA for any unhandled routes (Express 5 compatible)
app.use((req, res) => {
    const indexPath = path.join(process.cwd(), "public", "index.html")
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath)
    } else {
        res.status(404).send("API Server running. Static frontend not found.")
    }
})

httpServer.listen(3000, () => {
    console.log("Server is running on port 3000")
})
