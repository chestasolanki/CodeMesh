import './App.css'
import { Editor } from '@monaco-editor/react'
import { MonacoBinding } from 'y-monaco'
import { useRef, useMemo, useState, useEffect } from 'react'
import * as Y from 'yjs'
import { SocketIOProvider } from 'y-socket.io'

const App = () => {

  const [username, setUsername] = useState(() => {
    return new URLSearchParams(window.location.search).get('username') || ''
  })

  const [users, setUsers] = useState([])
  const [output, setOutput] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const editorRef = useRef(null)
  const bindingRef = useRef(null)

  const ydoc = useMemo(() => new Y.Doc(), [])
  const yText = useMemo(() => ydoc.getText('monaco'), [ydoc])

  const handleMount = (editor) => {
    editorRef.current = editor
    
    if (bindingRef.current) {
      bindingRef.current.destroy()
    }

    bindingRef.current = new MonacoBinding(
      yText,
      editorRef.current.getModel(),
      new Set([editorRef.current])
    )
  }

  useEffect(() => {
    if (username) {
      const provider = new SocketIOProvider('/', 'monaco', ydoc, {
        autoConnect: true
      })

      provider.awareness.setLocalStateField('user', { username })

      const updateUsersList = () => {
        const states = Array.from(provider.awareness.getStates().values())
        const allUsers = states
          .filter(state => state && state.user && state.user.username)
          .map(state => state.user)

        const uniqueUsers = Array.from(
          new Map(allUsers.map(user => [user.username, user])).values()
        )

        setUsers(uniqueUsers)
      }

      updateUsersList()
      provider.awareness.on("change", updateUsersList)

      function handleBeforeUnload() {
        provider.awareness.setLocalStateField("user", null)
      }

      window.addEventListener("beforeunload", handleBeforeUnload)

      return () => {
        if (bindingRef.current) {
          bindingRef.current.destroy()
          bindingRef.current = null
        }
        provider.disconnect()
        window.removeEventListener("beforeunload", handleBeforeUnload)
      }
    }
  }, [username, ydoc])

  // C++ Code Execution Handler using Piston API
    const handleRunCode = async () => {
    if (!editorRef.current) return

    const codeToRun = editorRef.current.getValue()

    setIsLoading(true)
    setOutput("Compiling & Running C++ code...")

    try {
      const apiBaseUrl = window.location.origin
      const response = await fetch(`${apiBaseUrl}/api/compile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeToRun })
      })

      const data = await response.json()

      if (data.run) {
        if (data.run.stderr) {
          setOutput(data.run.stderr) // Displays g++ compilation errors
        } else {
          setOutput(data.run.stdout || "Program executed successfully with no output.")
        }
      } else {
        setOutput(data.message || "Execution failed.")
      }
    } catch (error) {
      setOutput("Error connecting to backend server.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleJoin = (e) => {
    e.preventDefault()
    const enteredName = e.target.username.value.trim()
    if (enteredName) {
      setUsername(enteredName)
      window.history.pushState({}, '', `?username=${enteredName}`)
    }
  }

  const handleDisconnect = () => {
    if (bindingRef.current) {
      bindingRef.current.destroy()
      bindingRef.current = null
    }
    setUsers([])
    setOutput('')
    setUsername('')
    window.history.pushState({}, '', window.location.pathname)
  }

  if (!username) {
    return (
      <main className='h-screen w-full bg-gray-950 flex gap-4 p-4 justify-center items-center'>
        <form onSubmit={handleJoin} className='flex flex-col gap-4'>
          <input 
            type="text" 
            name="username"  
            placeholder="Enter your name" 
            className='p-2 bg-amber-50 rounded-lg text-black' 
            required
          />
          <button className='p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition'>
            Join
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className='h-screen w-full bg-gray-950 flex gap-4 p-4'>
      {/* Sidebar - Users & Disconnect */}
      <aside className='h-full w-1/4 bg-amber-50 rounded-lg flex flex-col justify-between overflow-hidden'>
        <div>
          <h2 className='text-lg font-bold p-4 border-b border-gray-300 text-black'>
            Users ({users.length})
          </h2>
          <ul className='p-4 overflow-y-auto max-h-[calc(100vh-160px)]'>
            {users.map((user, index) => (
              <li key={index} className='p-2 border-b border-gray-300 text-black font-medium flex items-center gap-2'>
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                {user.username}
              </li>
            ))}
          </ul>
        </div>
        <div className='p-4 border-t border-gray-300 bg-amber-100'>
          <button 
            onClick={handleDisconnect}
            className='w-full p-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition'
          >
            Disconnect
          </button>
        </div>
      </aside>

      {/* Main Section - Editor + Header + Output Console */}
      <section className='w-3/4 flex flex-col gap-2 h-full'>
        {/* Top Action Bar */}
        <div className='bg-neutral-900 p-3 rounded-lg flex justify-between items-center text-white'>
          <span className='font-semibold text-gray-300'>C++ Editor</span>
          <button
            onClick={handleRunCode}
            disabled={isLoading}
            className='bg-green-600 hover:bg-green-700 disabled:bg-gray-600 px-4 py-1.5 rounded-lg text-white font-semibold transition flex items-center gap-2'
          >
            {isLoading ? "Running..." : "▶ Run Code"}
          </button>
        </div>

        {/* Monaco Editor Component */}
        <div className='flex-1 rounded-lg overflow-hidden'>
          <Editor
            height="100%"
            defaultLanguage="cpp"
            defaultValue={`#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, CodeMesh!" << endl;\n    return 0;\n}`}
            theme='vs-dark'
            onMount={handleMount}
          />
        </div>

        {/* Output Console Component */}
        <div className='h-40 bg-neutral-900 text-white rounded-lg p-3 flex flex-col font-mono overflow-hidden border border-neutral-700'>
          <div className='text-xs text-gray-400 font-bold mb-1 border-b border-neutral-800 pb-1'>
            OUTPUT CONSOLE:
          </div>
          <pre className='flex-1 overflow-y-auto text-green-400 whitespace-pre-wrap text-sm'>
            {output || "Click '▶ Run Code' to compile and see the output here."}
          </pre>
        </div>
      </section>
    </main>
  )
}

export default App