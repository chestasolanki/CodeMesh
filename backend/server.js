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

// Local C++ Compilation Route
app.post('/api/compile', (req, res) => {
    try {
        const { code } = req.body || {}

        if (!code) {
            return res.status(400).json({ error: "No code provided in request body" })
        }

        const id = Date.now()
        const filePath = path.join(process.cwd(), `temp_${id}.cpp`)
        const outPath = path.join(process.cwd(), `temp_${id}.out`)

        const cleanup = () => {
            if (fs.existsSync(filePath)) {
                try { fs.unlinkSync(filePath) } catch (e) {}
            }
            if (fs.existsSync(outPath)) {
                try { fs.unlinkSync(outPath) } catch (e) {}
            }
        }

        // 1. Write code string to file
        fs.writeFile(filePath, code, (writeErr) => {
            if (writeErr) {
                console.error("Write File Error:", writeErr)
                return res.status(500).json({ error: "Failed to create source file" })
            }

            // 2. Compile C++ code using g++ (with -I. for local bits/stdc++.h support)
            exec(`g++ -I. "${filePath}" -o "${outPath}"`, (compileErr, stdout, stderr) => {
                if (compileErr) {
                    cleanup()
                    return res.json({ run: { stderr: stderr || compileErr.message } })
                }

                // 3. Make executable and run binary
                exec(`chmod +x "${outPath}" && "${outPath}"`, { timeout: 5000 }, (runErr, runStdout, runStderr) => {
                    cleanup()

                    if (runErr) {
                        if (runErr.killed) {
                            return res.json({ run: { stderr: "Time Limit Exceeded (Infinite loop)" } })
                        }
                        return res.json({ run: { stderr: runStderr || runErr.message } })
                    }

                    return res.json({ run: { stdout: runStdout } })
                })
            })
        })
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
