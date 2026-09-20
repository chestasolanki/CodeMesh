import './App.css'
import { Editor } from '@monaco-editor/react'
import { MonacoBinding } from 'y-monaco'
import { useRef, useMemo, useState, useEffect } from 'react'
import * as Y from 'yjs'
import { SocketIOProvider } from 'y-socket.io'
import { io as ioClient } from 'socket.io-client'

// Helper: Generate colorful avatar backgrounds based on username
const AVATAR_COLORS = [
  'bg-purple-600 border-purple-400',
  'bg-blue-600 border-blue-400',
  'bg-emerald-600 border-emerald-400',
  'bg-amber-600 border-amber-400',
  'bg-rose-600 border-rose-400',
  'bg-indigo-600 border-indigo-400',
  'bg-teal-600 border-teal-400',
  'bg-pink-600 border-pink-400'
]

const getAvatarColor = (name = '') => {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

const getInitials = (name = '') => {
  if (!name) return '?'
  const parts = name.trim().split(' ')
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

// Helper: Generate random 6-character room code
const generateRoomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

// Helper: Determine Backend Socket.IO URL dynamically
const getSocketUrl = () => {
  if (import.meta.env.VITE_BACKEND_URL) {
    return import.meta.env.VITE_BACKEND_URL
  }
  if (
    typeof window !== 'undefined' &&
    window.location.hostname === 'localhost' &&
    window.location.port !== '3000'
  ) {
    return 'http://localhost:3000'
  }
  return window.location.origin
}

const App = () => {
  // Read params from URL if present
  const searchParams = new URLSearchParams(window.location.search)
  const initialRoomFromUrl = searchParams.get('room') || ''
  const initialUserFromUrl = searchParams.get('username') || ''

  const [username, setUsername] = useState(initialUserFromUrl)
  const [roomId, setRoomId] = useState(initialRoomFromUrl)
  const [isHost, setIsHost] = useState(false)

  // Landing page tab state: 'join' or 'create'
  const [activeTab, setActiveTab] = useState(initialRoomFromUrl ? 'join' : 'join')

  // Form input states & errors
  const [createFormName, setCreateFormName] = useState('')
  const [joinFormName, setJoinFormName] = useState(initialUserFromUrl)
  const [joinFormCode, setJoinFormCode] = useState(initialRoomFromUrl)
  const [formError, setFormError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [users, setUsers] = useState([])
  const [output, setOutput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [copyNotification, setCopyNotification] = useState('')

  // Chat state using Yjs Method 1 (Y.Array)
  const [chatMessages, setChatMessages] = useState([])
  const [messageInput, setMessageInput] = useState('')

  const editorRef = useRef(null)
  const bindingRef = useRef(null)
  const providerRef = useRef(null)
  const trackingSocketRef = useRef(null)
  const chatEndRef = useRef(null)

  // Ref to track seen users in room
  const seenUsersRef = useRef(new Map())

  // Yjs shared document setup
  const ydoc = useMemo(() => new Y.Doc(), [])
  const yText = useMemo(() => ydoc.getText('monaco'), [ydoc])
  const yChatArray = useMemo(() => ydoc.getArray('chat-messages'), [ydoc])

  // Sync Y.Array chat messages to React local state
  useEffect(() => {
    const updateChat = () => {
      setChatMessages(yChatArray.toArray())
    }
    updateChat()
    yChatArray.observe(updateChat)
    return () => {
      yChatArray.unobserve(updateChat)
    }
  }, [yChatArray])

  // Auto-scroll chat to bottom on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const handleMount = (editor) => {
    editorRef.current = editor

    if (bindingRef.current) {
      try {
        bindingRef.current.destroy()
      } catch (e) {}
      bindingRef.current = null
    }

    if (providerRef.current && editor && editor.getModel()) {
      try {
        bindingRef.current = new MonacoBinding(
          yText,
          editor.getModel(),
          new Set([editor]),
          providerRef.current.awareness
        )
      } catch (e) {
        console.error('MonacoBinding Mount Error:', e)
      }
    }
  }

  // Handle Socket.IO & Yjs Synchronization for the joined room
  useEffect(() => {
    if (username && roomId) {
      const socketUrl = getSocketUrl()

      // Connect Yjs SocketIOProvider
      const provider = new SocketIOProvider(socketUrl, roomId, ydoc, {
        autoConnect: true
      })
      providerRef.current = provider

      // Emit room tracking for server side auto-deletion when empty
      const trackingSocket = ioClient(socketUrl)
      trackingSocketRef.current = trackingSocket
      trackingSocket.emit('join-room-tracking', { roomId })

      const userAvatarColor = getAvatarColor(username)
      provider.awareness.setLocalStateField('user', {
        username,
        isHost,
        avatarColor: userAvatarColor
      })

      // Update user list with active and inactive (offline) statuses
      const updateUsersList = () => {
        const states = Array.from(provider.awareness.getStates().values())
        const activeUserMap = new Map()

        states.forEach((state) => {
          if (state && state.user && state.user.username) {
            activeUserMap.set(state.user.username, {
              ...state.user,
              status: 'active'
            })
            // Record in seen users map
            seenUsersRef.current.set(state.user.username, {
              ...state.user,
              status: 'active'
            })
          }
        })

        // Build list of active and inactive users
        const updatedList = []
        seenUsersRef.current.forEach((u, name) => {
          if (activeUserMap.has(name)) {
            updatedList.push({ ...u, status: 'active' })
          } else {
            updatedList.push({ ...u, status: 'inactive' })
          }
        })

        setUsers(updatedList)
      }

      updateUsersList()
      provider.awareness.on('change', updateUsersList)
      provider.awareness.on('update', updateUsersList)

      // Bind Monaco Editor safely if mounted
      if (editorRef.current && editorRef.current.getModel()) {
        if (bindingRef.current) {
          try {
            bindingRef.current.destroy()
          } catch (e) {}
          bindingRef.current = null
        }
        try {
          bindingRef.current = new MonacoBinding(
            yText,
            editorRef.current.getModel(),
            new Set([editorRef.current]),
            provider.awareness
          )
        } catch (e) {
          console.error('MonacoBinding sync error:', e)
        }
      }

      const handleBeforeUnload = () => {
        try {
          provider.awareness.setLocalStateField('user', null)
          trackingSocket.disconnect()
          provider.disconnect()
        } catch (e) {}
      }

      window.addEventListener('beforeunload', handleBeforeUnload)

      return () => {
        if (bindingRef.current) {
          try {
            bindingRef.current.destroy()
          } catch (e) {}
          bindingRef.current = null
        }
        try {
          provider.disconnect()
          trackingSocket.disconnect()
        } catch (e) {}
        providerRef.current = null
        trackingSocketRef.current = null
        window.removeEventListener('beforeunload', handleBeforeUnload)
      }
    }
  }, [username, roomId, isHost, ydoc, yText])

  // Method 1: Send Chat Message via Yjs Shared Array (Y.Array)
  const handleSendMessage = (e) => {
    e?.preventDefault()
    if (!messageInput.trim()) return

    const newMsg = {
      id: Date.now() + Math.random(),
      sender: username,
      text: messageInput.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    yChatArray.push([newMsg])
    setMessageInput('')
  }

  // C++ Code Execution Handler
  const handleRunCode = async () => {
    if (!editorRef.current) return

    const codeToRun = editorRef.current.getValue()

    setIsLoading(true)
    setOutput('> Build started...\n')

    const startTime = performance.now()

    try {
      const apiBaseUrl = getSocketUrl()
      const response = await fetch(`${apiBaseUrl}/api/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeToRun })
      })

      const data = await response.json()
      const duration = ((performance.now() - startTime) / 1000).toFixed(1)

      if (data.run) {
        if (data.run.stderr) {
          setOutput(`> Build started...\n> Compilation output:\n${data.run.stderr}\n\n[Program finished in ${duration}s]`)
        } else {
          const runResult = data.run.stdout || 'Program executed successfully with no output.'
          setOutput(`> Build started...\n> Build successful (${duration}s)\n\n${runResult}\n[Program finished in ${duration}s]`)
        }
      } else {
        setOutput(`> Build failed.\n${data.message || 'Execution error.'}`)
      }
    } catch (error) {
      setOutput('> Error connecting to backend execution server.')
    } finally {
      setIsLoading(false)
    }
  }

  // Form Handlers
  const handleCreateRoomSubmit = async (e) => {
    e.preventDefault()
    if (!createFormName.trim()) return

    setFormError('')
    setIsSubmitting(true)
    const newCode = generateRoomCode()

    try {
      const apiBaseUrl = getSocketUrl()
      const res = await fetch(`${apiBaseUrl}/api/rooms/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: newCode })
      })
      const data = await res.json()

      if (data.success) {
        seenUsersRef.current.clear()
        setUsername(createFormName.trim())
        setRoomId(newCode)
        setIsHost(true)
        window.history.pushState({}, '', `?room=${newCode}&username=${encodeURIComponent(createFormName.trim())}`)
      } else {
        setFormError('Failed to register room on server. Try again.')
      }
    } catch (err) {
      setFormError('Network error connecting to backend server.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleJoinRoomSubmit = async (e) => {
    e.preventDefault()
    if (!joinFormName.trim() || !joinFormCode.trim()) return

    setFormError('')
    setIsSubmitting(true)
    const formattedCode = joinFormCode.trim().toUpperCase()

    try {
      const apiBaseUrl = getSocketUrl()
      const res = await fetch(`${apiBaseUrl}/api/rooms/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: formattedCode })
      })
      const data = await res.json()

      if (data.valid) {
        seenUsersRef.current.clear()
        setUsername(joinFormName.trim())
        setRoomId(formattedCode)
        setIsHost(false)
        window.history.pushState({}, '', `?room=${formattedCode}&username=${encodeURIComponent(joinFormName.trim())}`)
      } else {
        setFormError('❌ Invalid Room Code. This room does not exist or has been closed.')
      }
    } catch (err) {
      setFormError('Network error verifying room code.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCopyCode = () => {
    if (!roomId) return
    navigator.clipboard.writeText(roomId)
    setCopyNotification('Copied!')
    setTimeout(() => setCopyNotification(''), 2500)
  }

  const handleDisconnect = () => {
    if (bindingRef.current) {
      try {
        bindingRef.current.destroy()
      } catch (e) {}
      bindingRef.current = null
    }
    if (providerRef.current) {
      try {
        providerRef.current.awareness.setLocalStateField('user', null)
        providerRef.current.disconnect()
      } catch (e) {}
    }
    if (trackingSocketRef.current) {
      try {
        trackingSocketRef.current.disconnect()
      } catch (e) {}
    }
    editorRef.current = null
    seenUsersRef.current.clear()
    setUsers([])
    setOutput('')
    setUsername('')
    setRoomId('')
    setIsHost(false)
    setFormError('')
    window.history.pushState({}, '', window.location.pathname)
  }

  // -------------------------------------------------------------
  // LANDING PAGE: MATCHING SCREENSHOT EXACTLY (DARK THEME ONLY)
  // -------------------------------------------------------------
  if (!username || !roomId) {
    return (
      <main className="h-screen w-full bg-[#18181b] flex flex-col justify-between items-center py-8 px-4 relative overflow-y-auto font-sans text-slate-100 select-none">
        {/* LOGO */}
        <div className="flex items-center gap-2 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-black text-xl shadow-lg border border-emerald-400/30">
            &lt;i&gt;
          </div>
          <span className="text-3xl font-extrabold tracking-tight text-white">
            CodeMesh
          </span>
        </div>

        {/* HERO TITLE & SUBTITLE */}
        <div className="text-center flex flex-col items-center my-auto">
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight flex items-center gap-3 mb-3">
            <span>Code Together,</span>
            <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-4 py-1 rounded-full text-3xl md:text-4xl">
              Anytime
            </span>
          </h1>

          <div className="inline-flex items-center gap-2 bg-[#27272a] border border-slate-700/80 px-4 py-1.5 rounded-full text-slate-300 text-xs font-semibold mb-8 shadow-sm">
            <span>Real-time collaborative coding and chat</span>
          </div>

          {/* MAIN CARD CONTAINER */}
          <div className="w-full max-w-lg bg-[#27272a]/90 border border-slate-700/80 rounded-3xl p-6 shadow-2xl backdrop-blur-lg">
            {/* TABS: JOIN ROOM vs CREATE ROOM */}
            <div className="grid grid-cols-2 gap-2 bg-[#18181b] p-1.5 rounded-2xl border border-slate-700/60 mb-6">
              <button
                onClick={() => {
                  setActiveTab('join')
                  setFormError('')
                }}
                className={`py-2.5 text-xs font-bold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 ${
                  activeTab === 'join'
                    ? 'bg-emerald-500 text-slate-950 shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>👤+</span> Join Room
              </button>
              <button
                onClick={() => {
                  setActiveTab('create')
                  setFormError('')
                }}
                className={`py-2.5 text-xs font-bold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 ${
                  activeTab === 'create'
                    ? 'bg-emerald-500 text-slate-950 shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>+</span> Create Room
              </button>
            </div>

            {/* FORM ERROR BANNER */}
            {formError && (
              <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-semibold rounded-xl text-center">
                {formError}
              </div>
            )}

            {/* JOIN ROOM FORM */}
            {activeTab === 'join' && (
              <form onSubmit={handleJoinRoomSubmit} className="flex flex-col gap-4 text-left">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-1">
                    Your Display Name
                  </label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3.5 text-slate-500 text-sm">👤</span>
                    <input
                      type="text"
                      placeholder="e.g. chesta"
                      value={joinFormName}
                      onChange={(e) => setJoinFormName(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-[#18181b] border border-slate-700 rounded-2xl text-white font-medium text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-1">
                    Room Code (generated by host)
                  </label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3.5 text-slate-500 text-sm font-bold">#</span>
                    <input
                      type="text"
                      placeholder="e.g. Z24RZN"
                      value={joinFormCode}
                      onChange={(e) => setJoinFormCode(e.target.value.toUpperCase())}
                      className="w-full pl-10 pr-4 py-3 bg-[#18181b] border border-slate-700 rounded-2xl text-emerald-400 font-mono font-bold tracking-widest text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition uppercase"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full mt-2 py-3.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-sm rounded-2xl shadow-lg transition transform active:scale-95 flex items-center justify-center gap-2"
                >
                  <span>{isSubmitting ? 'Verifying...' : 'Join Room'}</span>
                  <span className="text-base">➔</span>
                </button>

                <p className="text-[11px] text-slate-500 text-center italic mt-1">
                  Enter the room code shared by the host to join the session.
                </p>
              </form>
            )}

            {/* CREATE ROOM FORM */}
            {activeTab === 'create' && (
              <form onSubmit={handleCreateRoomSubmit} className="flex flex-col gap-4 text-left">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-1">
                    Your Display Name
                  </label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3.5 text-slate-500 text-sm">👤</span>
                    <input
                      type="text"
                      placeholder="e.g. Alex"
                      value={createFormName}
                      onChange={(e) => setCreateFormName(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-[#18181b] border border-slate-700 rounded-2xl text-white font-medium text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full mt-2 py-3.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-sm rounded-2xl shadow-lg transition transform active:scale-95 flex items-center justify-center gap-2"
                >
                  <span>{isSubmitting ? 'Creating...' : 'Create Room'}</span>
                  <span className="text-base">➔</span>
                </button>

                <p className="text-[11px] text-slate-500 text-center italic mt-1">
                  Click create to generate a unique room code for your coding session.
                </p>
              </form>
            )}
          </div>

          {/* BOTTOM FEATURE BADGES */}
          <div className="flex flex-wrap items-center justify-center gap-4 mt-8">
            <div className="flex items-center gap-2 bg-[#27272a] border border-slate-700/80 px-3 py-1.5 rounded-full text-slate-300 text-xs font-semibold shadow-sm">
              <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs">👥</span>
              <span>Real-time Collaboration</span>
            </div>
            <div className="flex items-center gap-2 bg-[#27272a] border border-slate-700/80 px-3 py-1.5 rounded-full text-slate-300 text-xs font-semibold shadow-sm">
              <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs">💬</span>
              <span>Built-in Chat</span>
            </div>
            <div className="flex items-center gap-2 bg-[#27272a] border border-slate-700/80 px-3 py-1.5 rounded-full text-slate-300 text-xs font-semibold shadow-sm">
              <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs">🔒</span>
              <span>Private & Secure Rooms</span>
            </div>
          </div>
        </div>
      </main>
    )
  }

  // Active users count (excluding offline)
  const activeUsersCount = users.filter((u) => u.status === 'active').length

  // -------------------------------------------------------------
  // ROOM COLLABORATION VIEW
  // -------------------------------------------------------------
  return (
    <main className="h-screen w-full bg-[#0b0f19] text-slate-200 flex flex-col p-2.5 overflow-hidden font-sans select-none">
      {/* TOP HEADER BAR */}
      <header className="h-12 bg-[#111827] border border-slate-800 rounded-xl px-4 flex items-center justify-between mb-2 shadow-md shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm text-slate-200 tracking-wide">C++ Playground</span>
          <span className="text-slate-600">|</span>
          <span className="text-xs text-slate-400 font-medium">
            {activeUsersCount} active editor{activeUsersCount === 1 ? '' : 's'}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Run Code Button */}
          <button
            onClick={handleRunCode}
            disabled={isLoading}
            className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-700 text-slate-950 font-bold px-4 py-1.5 rounded-lg text-xs tracking-wide transition shadow flex items-center gap-2"
          >
            <span>▶ RUN CODE</span>
            <span className="bg-emerald-600/40 text-slate-900 px-1.5 py-0.5 rounded text-[10px] font-mono">⌘+R</span>
          </button>

          {/* User Avatars Stack */}
          <div className="flex items-center -space-x-2">
            {users.map((u, i) => (
              <div
                key={i}
                title={`${u.username}${u.isHost ? ' (Host)' : ''} (${u.status})`}
                className={`w-7 h-7 rounded-full ${
                  u.avatarColor || getAvatarColor(u.username)
                } border-2 border-[#111827] flex items-center justify-center font-bold text-white text-[10px] shadow relative ${
                  u.status === 'inactive' ? 'opacity-40 grayscale' : ''
                }`}
              >
                {getInitials(u.username)}
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* MAIN CONTENT WORKSPACE */}
      <div className="flex-1 flex gap-2 overflow-hidden">
        {/* LEFT SIDEBAR: ACTIVE ROOM & COLLABORATORS */}
        <aside className="w-64 bg-[#111827] border border-slate-800 rounded-xl flex flex-col justify-between p-3 shrink-0 shadow-lg">
          <div>
            {/* Active Room Code Box */}
            <div className="mb-4">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                ACTIVE ROOM:
              </span>
              <div className="flex items-center justify-between bg-[#0b0f19] p-2.5 rounded-lg border border-slate-800">
                <span className="font-mono text-xl font-extrabold text-emerald-400 tracking-wider">
                  {roomId}
                </span>
                <button
                  onClick={handleCopyCode}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-2.5 py-1 rounded border border-slate-700 transition font-medium flex items-center gap-1"
                >
                  <span>📋</span> COPY
                </button>
              </div>
              {copyNotification && (
                <span className="text-[10px] text-emerald-400 font-semibold block mt-1 text-center">
                  {copyNotification}
                </span>
              )}
            </div>

            {/* Connected Collaborators */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  CONNECTED COLLABORATORS
                </span>
                <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {users.length}
                </span>
              </div>

              <ul className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
                {users.map((u, i) => (
                  <li key={i} className="flex items-center justify-between bg-[#0b0f19] p-2 rounded-lg border border-slate-800">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={`w-7 h-7 rounded-full ${
                          u.avatarColor || getAvatarColor(u.username)
                        } flex items-center justify-center font-bold text-white text-[10px] shrink-0 ${
                          u.status === 'inactive' ? 'opacity-40 grayscale' : ''
                        }`}
                      >
                        {getInitials(u.username)}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-semibold text-slate-200 truncate">
                          {u.username} {u.username === username && '(You)'}
                        </span>
                        <span
                          className={`text-[9px] flex items-center gap-1 ${
                            u.status === 'active' ? 'text-emerald-400' : 'text-slate-500'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              u.status === 'active' ? 'bg-emerald-400' : 'bg-slate-600'
                            }`}
                          ></span>
                          {u.status === 'active' ? 'Connected' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                    {u.isHost && <span className="text-xs">👑</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Leave Room Button */}
          <button
            onClick={handleDisconnect}
            className="w-full py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/40 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2"
          >
            <span>⏁</span> Leave Room
          </button>
        </aside>

        {/* CENTER MAIN SECTION: MONACO EDITOR + OUTPUT CONSOLE */}
        <section className="flex-1 flex flex-col gap-2 min-w-0 overflow-hidden">
          {/* MONACO EDITOR CONTAINER */}
          <div className="flex-1 bg-[#111827] border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-lg">
            {/* Tab Header */}
            <div className="h-8 bg-[#0b0f19] border-b border-slate-800 px-3 flex items-center justify-between">
              <div className="flex items-center gap-2 bg-[#111827] px-3 py-1 rounded-t border-t border-x border-slate-800 text-xs font-medium text-slate-300">
                <span>C++ Playground</span>
                <span className="text-slate-500 text-[10px]">✕</span>
              </div>
            </div>

            {/* Monaco Editor Component */}
            <div className="flex-1 overflow-hidden">
              <Editor
                height="100%"
                defaultLanguage="cpp"
                defaultValue=""
                theme="vs-dark"
                onMount={handleMount}
                options={{
                  fontSize: 14,
                  minimap: { enabled: false },
                  smoothScrolling: true,
                  cursorBlinking: 'smooth'
                }}
              />
            </div>

            {/* Editor Footer Status Bar */}
            <div className="h-6 bg-[#0b0f19] border-t border-slate-800 px-3 flex items-center justify-between text-[10px] text-slate-500 font-mono">
              <span>Language: C++</span>
              <div className="flex items-center gap-4">
                <span>Spacing: 5.0</span>
                <span>Column: %: 10</span>
              </div>
            </div>
          </div>

          {/* BOTTOM OUTPUT CONSOLE */}
          <div className="h-36 bg-[#111827] border border-slate-800 rounded-xl p-3 flex flex-col font-mono text-xs overflow-hidden shadow-lg">
            <div className="text-[11px] font-bold text-slate-400 border-b border-slate-800 pb-1 mb-1.5 flex justify-between items-center">
              <span>OUTPUT CONSOLE</span>
              {output && (
                <button onClick={() => setOutput('')} className="text-[10px] text-slate-500 hover:text-slate-300">
                  Clear
                </button>
              )}
            </div>
            <pre className="flex-1 overflow-y-auto text-emerald-400 whitespace-pre-wrap leading-relaxed font-mono">
              {output || 'Click "▶ RUN CODE" to compile C++ code and view output here.'}
            </pre>
          </div>
        </section>

        {/* RIGHT PANEL: COLLABORATORS & REAL-TIME CHAT (METHOD 1 YJS Y.ARRAY) */}
        <aside className="w-72 bg-[#111827] border border-slate-800 rounded-xl flex flex-col p-3 shrink-0 shadow-lg overflow-hidden">
          {/* COLLABORATORS LIST */}
          <div className="h-44 border-b border-slate-800 pb-3 mb-3 flex flex-col">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">
              COLLABORATORS
            </span>
            <ul className="space-y-2 overflow-y-auto flex-1 pr-1">
              {users.map((u, i) => (
                <li key={i} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-6 h-6 rounded-full ${
                        u.avatarColor || getAvatarColor(u.username)
                      } flex items-center justify-center text-[10px] font-bold text-white ${
                        u.status === 'inactive' ? 'opacity-40 grayscale' : ''
                      }`}
                    >
                      {getInitials(u.username)}
                    </div>
                    <span
                      className={`font-semibold ${
                        u.status === 'inactive' ? 'text-slate-500 line-through' : 'text-slate-200'
                      }`}
                    >
                      {u.username} {u.isHost && '(Host)'}
                    </span>
                  </div>
                  <span
                    className={`text-[10px] font-mono ${
                      u.status === 'active' ? 'text-emerald-400' : 'text-slate-500'
                    }`}
                  >
                    {u.status === 'active' ? '● active' : '○ inactive'}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* REAL-TIME CHAT PANEL (METHOD 1 Y.ARRAY) */}
          <div className="flex-1 flex flex-col min-h-0">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">
              CHAT
            </span>

            {/* Chat Messages Display Window */}
            <div className="flex-1 bg-[#0b0f19] border border-slate-800 rounded-lg p-2.5 overflow-y-auto space-y-2 mb-2 text-xs font-sans">
              {chatMessages.length === 0 ? (
                <span className="text-slate-500 italic text-[11px] text-center block mt-4">
                  No messages yet. Send a message to start chatting!
                </span>
              ) : (
                chatMessages.map((msg, index) => (
                  <div key={msg.id || index} className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between">
                      <span
                        className={`font-bold text-[11px] ${
                          msg.sender === username ? 'text-emerald-400' : 'text-indigo-400'
                        }`}
                      >
                        {msg.sender === username ? 'You' : msg.sender}:
                      </span>
                      <span className="text-[9px] text-slate-500">{msg.time}</span>
                    </div>
                    <p className="text-slate-200 bg-[#111827] px-2.5 py-1.5 rounded-lg border border-slate-800 break-words leading-normal">
                      {msg.text}
                    </p>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Message Input Form */}
            <form onSubmit={handleSendMessage} className="flex items-center gap-1.5">
              <input
                type="text"
                placeholder="Message on chat..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                className="flex-1 px-3 py-2 bg-[#0b0f19] border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
              />
              <button
                type="submit"
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 p-2 rounded-lg font-bold text-xs transition"
                title="Send Message"
              >
                ➤
              </button>
            </form>
          </div>
        </aside>
      </div>
    </main>
  )
}

export default App