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

// IMPORTANT: Middleware MUST be at the top before routes
app.use(cors())
app.use(express.json())

const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    }
})

const ySocketIO = new YSocketIO(io)
ySocketIO.initialize()

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

            // 2. Compile C++ code using g++
            exec(`g++ "${filePath}" -o "${outPath}"`, (compileErr, stdout, stderr) => {
                if (compileErr) {
                    cleanup()
                    // Send compilation errors (syntax errors) to frontend
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

                    // Return standard output
                    return res.json({ run: { stdout: runStdout } })
                })
            })
        })
    } catch (err) {
        console.error("Unexpected Server Error:", err)
        return res.status(500).json({ error: "Internal Server Error" })
    }
})

app.get("/", (req, res) => {
    res.status(200).json({ message: "hello world", success: true })
})

httpServer.listen(3000, () => {
    console.log("Server is running on port 3000")
})