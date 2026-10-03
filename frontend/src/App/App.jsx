import './App.css'
import { Editor } from '@monaco-editor/react'
import { MonacoBinding } from 'y-monaco'
import { useRef, useMemo, useState, useEffect } from 'react'
import * as Y from 'yjs'
import { SocketIOProvider } from 'y-socket.io'
import { io as ioClient } from 'socket.io-client'

// Default starter C++ code template
const DEFAULT_CPP_TEMPLATE = `#include <bits/stdc++.h>
using namespace std;

int main() {
    cout << "Hello World!\\n";
    return 0;
}
`

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

  // VS Code Sidebar & Terminal Panel tab states
  const [activeNav, setActiveNav] = useState('all')
  const [activeBottomTab, setActiveBottomTab] = useState('terminal')

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

  // Quick Generate Unique Room ID Handler
  const handleGenerateQuickRoomId = async () => {
    const newCode = generateRoomCode()
    setJoinFormCode(newCode)
    setFormError('')
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
  // LANDING PAGE: MATCHING UPLOADED SCREENSHOT (CODESYNC GREEN THEME)
  // -------------------------------------------------------------
  if (!username || !roomId) {
    return (
      <main className="h-screen w-full bg-[#05130e] text-slate-100 flex flex-col justify-between p-6 relative overflow-hidden font-sans select-none">
        {/* Ambient Radial Green Background Glows */}
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-emerald-600/10 rounded-full blur-[120px] pointer-events-none"></div>
        <div className="absolute bottom-10 right-10 w-[400px] h-[400px] bg-teal-500/10 rounded-full blur-[100px] pointer-events-none"></div>

        {/* Top Right Status Badge */}
        <div className="w-full flex justify-end">
          <div className="inline-flex items-center gap-2 bg-[#092119] border border-emerald-900/60 px-3 py-1.5 rounded-full text-[11px] font-semibold text-emerald-400 shadow">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Ready to collaborate</span>
          </div>
        </div>

        {/* Main 2-Column Hero Container */}
        <div className="max-w-6xl w-full mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center my-auto z-10">
          {/* LEFT COLUMN: COLLABORATION VECTOR ILLUSTRATION */}
          <div className="hidden lg:flex justify-center items-center relative">
            <div className="w-full max-w-md aspect-square rounded-full bg-emerald-950/20 border border-emerald-800/30 flex items-center justify-center p-8 relative shadow-2xl backdrop-blur-sm">
              {/* High Quality 4-Developer Collaboration Vector Illustration */}
              <svg viewBox="0 0 500 500" className="w-full h-full drop-shadow-2xl">
                <defs>
                  <linearGradient id="greenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#00c985" />
                    <stop offset="100%" stopColor="#10b981" />
                  </linearGradient>
                  <linearGradient id="darkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#0a2b20" />
                    <stop offset="100%" stopColor="#051a13" />
                  </linearGradient>
                </defs>

                {/* Outer Glow Ring & Background Mesh */}
                <circle cx="250" cy="250" r="215" fill="none" stroke="#00c985" strokeWidth="2" strokeDasharray="8 8" opacity="0.35" />
                <circle cx="250" cy="250" r="180" fill="#064e3b" opacity="0.12" />

                {/* Desk Base */}
                <ellipse cx="250" cy="380" rx="210" ry="26" fill="#09241b" stroke="#0e3a2b" strokeWidth="1.5" />

                {/* Back Developers (Dev 2 & Dev 3 - Upper Level) */}
                {/* Dev 2 - Back Left */}
                <g>
                  <rect x="150" y="132" width="40" height="16" rx="4" fill="#10b981" />
                  <text x="170" y="143" fill="#05130e" fontSize="9" fontWeight="bold" textAnchor="middle">Dev 2</text>
                  <circle cx="170" cy="172" r="19" fill="#10b981" />
                  <path d="M 148 222 Q 170 192 192 222 Z" fill="#047857" />
                </g>

                {/* Dev 3 - Back Right */}
                <g>
                  <rect x="310" y="132" width="40" height="16" rx="4" fill="#34d399" />
                  <text x="330" y="143" fill="#05130e" fontSize="9" fontWeight="bold" textAnchor="middle">Dev 3</text>
                  <circle cx="330" cy="172" r="19" fill="#34d399" />
                  <path d="M 308 222 Q 330 192 352 222 Z" fill="#065f46" />
                </g>

                {/* Central Collaborative Monitors Setup */}
                {/* Side Left Monitor */}
                <rect x="55" y="200" width="95" height="68" rx="8" fill="url(#darkGrad)" stroke="#00c985" strokeWidth="1.5" />
                <line x1="68" y1="220" x2="132" y2="220" stroke="#34d399" strokeWidth="3" strokeLinecap="round" />
                <line x1="68" y1="232" x2="112" y2="232" stroke="#059669" strokeWidth="3" strokeLinecap="round" />
                <line x1="68" y1="244" x2="138" y2="244" stroke="#00c985" strokeWidth="3" strokeLinecap="round" />

                {/* Main Central Screen */}
                <rect x="155" y="160" width="190" height="115" rx="10" fill="url(#darkGrad)" stroke="#00c985" strokeWidth="2.5" />
                <rect x="155" y="160" width="190" height="20" rx="10" fill="#072017" />
                <circle cx="168" cy="170" r="3.5" fill="#ef4444" />
                <circle cx="179" cy="170" r="3.5" fill="#f59e0b" />
                <circle cx="190" cy="170" r="3.5" fill="#10b981" />
                {/* Code Lines on Main Monitor */}
                <line x1="172" y1="195" x2="265" y2="195" stroke="#00c985" strokeWidth="4" strokeLinecap="round" />
                <line x1="172" y1="210" x2="225" y2="210" stroke="#34d399" strokeWidth="4" strokeLinecap="round" />
                <line x1="172" y1="225" x2="318" y2="225" stroke="#059669" strokeWidth="4" strokeLinecap="round" />
                <line x1="172" y1="240" x2="285" y2="240" stroke="#6ee7b7" strokeWidth="4" strokeLinecap="round" />
                <line x1="172" y1="255" x2="235" y2="255" stroke="#00c985" strokeWidth="4" strokeLinecap="round" />

                {/* Side Right Monitor */}
                <rect x="350" y="200" width="95" height="68" rx="8" fill="url(#darkGrad)" stroke="#00c985" strokeWidth="1.5" />
                <line x1="363" y1="220" x2="427" y2="220" stroke="#34d399" strokeWidth="3" strokeLinecap="round" />
                <line x1="363" y1="232" x2="402" y2="232" stroke="#00c985" strokeWidth="3" strokeLinecap="round" />
                <line x1="363" y1="244" x2="430" y2="244" stroke="#059669" strokeWidth="3" strokeLinecap="round" />

                {/* Front Developers (Dev 1 & Dev 4 - Foreground) */}
                {/* Dev 1 - Front Left */}
                <g>
                  <rect x="86" y="255" width="42" height="17" rx="4" fill="#00c985" />
                  <text x="107" y="267" fill="#05130e" fontSize="9" fontWeight="bold" textAnchor="middle">Dev 1</text>
                  <circle cx="107" cy="300" r="25" fill="#00c985" />
                  <path d="M 72 370 Q 107 320 142 370 Z" fill="#064e3b" />
                </g>

                {/* Dev 4 - Front Right */}
                <g>
                  <rect x="372" y="255" width="42" height="17" rx="4" fill="#6ee7b7" />
                  <text x="393" y="267" fill="#05130e" fontSize="9" fontWeight="bold" textAnchor="middle">Dev 4</text>
                  <circle cx="393" cy="300" r="25" fill="#059669" />
                  <path d="M 358 370 Q 393 320 428 370 Z" fill="#064e3b" />
                </g>

                {/* Floating Badges */}
                <g className="animate-bounce" style={{ animationDuration: '4s' }}>
                  <rect x="215" y="75" width="70" height="42" rx="10" fill="url(#greenGrad)" />
                  <text x="250" y="101" fill="#05130e" fontSize="18" fontWeight="bold" textAnchor="middle">&lt;/&gt;</text>
                </g>

                <g className="animate-bounce" style={{ animationDuration: '5s' }}>
                  <rect x="50" y="105" width="60" height="38" rx="8" fill="#0a382a" stroke="#00c985" strokeWidth="1.5" />
                  <text x="80" y="129" fill="#00c985" fontSize="13" fontWeight="bold" textAnchor="middle">💬 Chat</text>
                </g>

                <g className="animate-bounce" style={{ animationDuration: '3.5s' }}>
                  <rect x="385" y="95" width="65" height="38" rx="8" fill="#0a382a" stroke="#00c985" strokeWidth="1.5" />
                  <text x="417.5" y="119" fill="#34d399" fontSize="13" fontWeight="bold" textAnchor="middle">⚡ Sync</text>
                </g>
              </svg>
            </div>
          </div>

          {/* RIGHT COLUMN: LOGO & FORM CARD (MATCHING SCREENSHOT) */}
          <div className="flex flex-col items-center lg:items-start max-w-md w-full mx-auto">
            {/* BRAND LOGO HEADER */}
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-black text-2xl shadow-lg shadow-emerald-500/20 border border-emerald-400/30">
                &lt;/&gt;
              </div>
              <div className="flex flex-col">
                <span className="text-3xl font-extrabold text-white tracking-tight leading-none">
                  CodeMesh
                </span>
                <span className="text-[11px] text-emerald-400 font-medium tracking-wide mt-1">
                  Code, Chat and Collaborate. It's All in Sync.
                </span>
              </div>
            </div>

            {/* MAIN FORM CARD */}
            <div className="w-full bg-[#0a1e16]/80 border border-emerald-900/60 rounded-2xl p-6 shadow-2xl backdrop-blur-md mt-4">
              {/* MODE SELECTOR TABS */}
              <div className="grid grid-cols-2 gap-2 bg-[#05130e] p-1 rounded-xl border border-emerald-900/50 mb-5">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('join')
                    setFormError('')
                  }}
                  className={`py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    activeTab === 'join'
                      ? 'bg-[#00c985] text-slate-950 shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>👤+</span> Join Room
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('create')
                    setFormError('')
                  }}
                  className={`py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    activeTab === 'create'
                      ? 'bg-[#00c985] text-slate-950 shadow-md'
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
                <form onSubmit={handleJoinRoomSubmit} className="flex flex-col gap-3.5">
                  <div>
                    <input
                      type="text"
                      placeholder="ROOM ID"
                      value={joinFormCode}
                      onChange={(e) => setJoinFormCode(e.target.value.toUpperCase())}
                      className="w-full px-4 py-3 bg-[#05130e] border border-emerald-800/80 rounded-xl text-emerald-300 font-mono font-bold tracking-widest text-sm placeholder-slate-500 focus:outline-none focus:border-[#00c985] focus:ring-1 focus:ring-[#00c985] transition uppercase"
                      required
                    />
                  </div>

                  <div>
                    <input
                      type="text"
                      placeholder="Your name"
                      value={joinFormName}
                      onChange={(e) => setJoinFormName(e.target.value)}
                      className="w-full px-4 py-3 bg-[#05130e] border border-emerald-900/80 rounded-xl text-white font-medium text-sm placeholder-slate-500 focus:outline-none focus:border-[#00c985] focus:ring-1 focus:ring-[#00c985] transition"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full mt-1 py-3 bg-[#00c985] hover:bg-[#00b377] disabled:opacity-50 text-slate-950 font-bold text-sm rounded-xl shadow-lg transition active:scale-[0.99]"
                  >
                    {isSubmitting ? 'Joining...' : 'Join'}
                  </button>
                </form>
              )}

              {/* CREATE ROOM FORM */}
              {activeTab === 'create' && (
                <form onSubmit={handleCreateRoomSubmit} className="flex flex-col gap-3.5">
                  <div>
                    <input
                      type="text"
                      placeholder="Your name"
                      value={createFormName}
                      onChange={(e) => setCreateFormName(e.target.value)}
                      className="w-full px-4 py-3 bg-[#05130e] border border-emerald-900/80 rounded-xl text-white font-medium text-sm placeholder-slate-500 focus:outline-none focus:border-[#00c985] focus:ring-1 focus:ring-[#00c985] transition"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full mt-1 py-3 bg-[#00c985] hover:bg-[#00b377] disabled:opacity-50 text-slate-950 font-bold text-sm rounded-xl shadow-lg transition active:scale-[0.99]"
                  >
                    {isSubmitting ? 'Creating Room...' : 'Create Room & Join'}
                  </button>
                </form>
              )}
            </div>

            {/* FOOTER CAPTION */}
            <span className="text-xs text-slate-400 mt-4 text-center">
              Collaborate on code in real-time with your team.
            </span>
          </div>
        </div>

        {/* FOOTER */}
        <div className="w-full text-center text-[11px] text-slate-500 py-2">
          CodeMesh &copy; {new Date().getFullYear()} — Real-time collaborative coding platform
        </div>
      </main>
    )
  }

  // Active users count (excluding offline)
  const activeUsersCount = users.filter((u) => u.status === 'active').length

  // -------------------------------------------------------------
  // ROOM COLLABORATION VIEW (VS CODE UI STYLING)
  // -------------------------------------------------------------
  return (
    <main className="h-screen w-full bg-[#1e1e1e] text-[#cccccc] flex flex-col overflow-hidden font-sans select-none">
      {/* 1. VS CODE TOP TITLE BAR */}
      <header className="h-9 bg-[#1f1f1f] border-b border-[#2b2b2b] px-3 flex items-center justify-between shrink-0 text-xs">
        {/* Left: Window Controls & App Branding */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[#ff5f56] inline-block"></span>
            <span className="w-3 h-3 rounded-full bg-[#ffbd2e] inline-block"></span>
            <span className="w-3 h-3 rounded-full bg-[#27c93f] inline-block"></span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-[#969696]">
            <span className="text-[#007acc] font-bold">&lt;/&gt; CodeMesh</span>
            <span>-</span>
            <span className="text-[#cccccc]">main.cpp</span>
            <span className="bg-[#2d2d2d] px-1.5 py-0.5 rounded text-[10px] text-[#00c985] font-mono border border-[#3c3c3c]">
              Room: {roomId}
            </span>
          </div>
        </div>

        {/* Center: Search / File Breadcrumb */}
        <div className="hidden md:flex items-center justify-center bg-[#2b2b2b] border border-[#3c3c3c] rounded px-8 py-0.5 text-[11px] text-[#858585]">
          <span>CodeMesh WorkSpace — main.cpp</span>
        </div>

        {/* Right: Quick Actions (Run Code, Copy Room, Leave) */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleRunCode}
            disabled={isLoading}
            className="bg-[#238636] hover:bg-[#2ea043] disabled:opacity-50 text-white font-semibold px-3 py-1 rounded text-[11px] transition shadow flex items-center gap-1.5"
            title="Compile & Run C++ Code (⌘+R)"
          >
            <span className="text-xs">▶</span>
            <span>{isLoading ? 'Running...' : 'Run Code'}</span>
            <span className="bg-black/30 text-[9px] px-1 rounded font-mono">⌘R</span>
          </button>

          <button
            onClick={handleCopyCode}
            className="bg-[#3c3c3c] hover:bg-[#4a4a4a] text-[#cccccc] px-2.5 py-1 rounded text-[11px] transition flex items-center gap-1"
            title="Copy Room ID to Clipboard"
          >
            <span>📋</span>
            <span>{copyNotification || 'Copy ID'}</span>
          </button>

          <button
            onClick={handleDisconnect}
            className="bg-[#3c3c3c] hover:bg-[#d73a49] text-rose-300 hover:text-white px-2.5 py-1 rounded text-[11px] transition flex items-center gap-1"
            title="Disconnect & Leave Room"
          >
            <span>🚪</span>
            <span>Leave</span>
          </button>
        </div>
      </header>

      {/* 2. MAIN WORKSPACE BODY (ACTIVITY BAR + SIDEBAR + EDITOR + TERMINAL) */}
      <div className="flex-1 flex overflow-hidden">
        {/* FAR LEFT: VS CODE ACTIVITY BAR */}
        <nav className="w-12 bg-[#181818] border-r border-[#2b2b2b] flex flex-col justify-between items-center py-2 shrink-0">
          <div className="flex flex-col gap-3 items-center w-full">
            <button
              onClick={() => setActiveNav('all')}
              className={`w-full py-2.5 flex justify-center text-lg relative transition ${
                activeNav === 'all'
                  ? 'text-white border-l-2 border-[#007acc] bg-[#252526]'
                  : 'text-[#858585] hover:text-white'
              }`}
              title="Explorer & Room Info"
            >
              📁
            </button>
            <button
              onClick={() => setActiveNav('users')}
              className={`w-full py-2.5 flex justify-center text-lg relative transition ${
                activeNav === 'users'
                  ? 'text-white border-l-2 border-[#007acc] bg-[#252526]'
                  : 'text-[#858585] hover:text-white'
              }`}
              title="Collaborators"
            >
              👥
              {activeUsersCount > 0 && (
                <span className="absolute top-1 right-1.5 w-4 h-4 bg-[#007acc] text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                  {activeUsersCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveNav('chat')}
              className={`w-full py-2.5 flex justify-center text-lg relative transition ${
                activeNav === 'chat'
                  ? 'text-white border-l-2 border-[#007acc] bg-[#252526]'
                  : 'text-[#858585] hover:text-white'
              }`}
              title="Real-Time Chat"
            >
              💬
              {chatMessages.length > 0 && (
                <span className="absolute top-1 right-1.5 w-4 h-4 bg-[#238636] text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                  {chatMessages.length}
                </span>
              )}
            </button>
          </div>

          <div className="flex flex-col items-center gap-2">
            <div
              title={`Logged in as ${username}`}
              className={`w-7 h-7 rounded-full ${getAvatarColor(
                username
              )} flex items-center justify-center text-[10px] font-bold text-white shadow`}
            >
              {getInitials(username)}
            </div>
          </div>
        </nav>

        {/* PRIMARY SIDEBAR (VS CODE COLLAPSIBLE PANELS) */}
        <aside className="w-72 bg-[#252526] border-r border-[#2b2b2b] flex flex-col shrink-0 overflow-hidden select-none">
          {/* Sidebar Title Header */}
          <div className="h-8 px-3 bg-[#252526] border-b border-[#2b2b2b] flex items-center justify-between text-[11px] font-bold text-[#bbbbbb] tracking-wider uppercase">
            <span>
              {activeNav === 'chat'
                ? 'REAL-TIME CHAT'
                : activeNav === 'users'
                ? 'COLLABORATORS'
                : 'EXPLORER: SESSION'}
            </span>
            <div className="flex items-center gap-1 text-[#858585]">
              <span className="hover:text-white cursor-pointer">...</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto flex flex-col divide-y divide-[#2b2b2b]">
            {/* PANEL 1: ROOM SESSION INFO */}
            {(activeNav === 'all' || activeNav === 'explorer') && (
              <div className="p-3 bg-[#1e1e1e]/40">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-[#858585] uppercase tracking-wider">
                    ROOM DETAILS
                  </span>
                  <span className="text-[10px] bg-[#007acc]/20 text-[#007acc] px-1.5 py-0.5 rounded font-mono">
                    LIVE YJS
                  </span>
                </div>
                <div className="bg-[#1e1e1e] p-2.5 rounded border border-[#333333] flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-[#858585] block uppercase font-mono">
                      ROOM ID
                    </span>
                    <span className="font-mono text-lg font-bold text-[#00c985] tracking-wider">
                      {roomId}
                    </span>
                  </div>
                  <button
                    onClick={handleCopyCode}
                    className="bg-[#2d2d2d] hover:bg-[#3c3c3c] text-[#cccccc] px-2.5 py-1 rounded text-xs border border-[#3c3c3c] transition font-medium"
                  >
                    Copy
                  </button>
                </div>
                {copyNotification && (
                  <span className="text-[10px] text-[#00c985] font-semibold block mt-1 text-center">
                    {copyNotification}
                  </span>
                )}
                {/* Virtual File Tree View */}
                <div className="mt-3">
                  <span className="text-[10px] font-bold text-[#858585] uppercase tracking-wider block mb-1.5">
                    WORKSPACE FILES
                  </span>
                  <div className="flex items-center gap-2 bg-[#2d2d2d] text-white px-2.5 py-1.5 rounded text-xs font-mono border-l-2 border-[#007acc]">
                    <span className="text-[#00c985] font-bold text-xs">C++</span>
                    <span>main.cpp</span>
                    <span className="ml-auto text-[10px] text-[#858585]">active</span>
                  </div>
                </div>
              </div>
            )}

            {/* PANEL 2: COLLABORATORS LIST */}
            {(activeNav === 'all' || activeNav === 'users') && (
              <div className="p-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-bold text-[#858585] uppercase tracking-wider">
                    COLLABORATORS ({users.length})
                  </span>
                  <span className="text-[10px] text-[#00c985] font-medium">
                    {activeUsersCount} online
                  </span>
                </div>
                <ul className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {users.map((u, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between bg-[#1e1e1e] p-2 rounded border border-[#2b2b2b] text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={`w-6 h-6 rounded-full ${
                            u.avatarColor || getAvatarColor(u.username)
                          } flex items-center justify-center font-bold text-white text-[10px] shrink-0 ${
                            u.status === 'inactive' ? 'opacity-40 grayscale' : ''
                          }`}
                        >
                          {getInitials(u.username)}
                        </div>
                        <span className="font-medium text-[#cccccc] truncate">
                          {u.username} {u.username === username && '(You)'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {u.isHost && (
                          <span
                            className="text-[10px] bg-[#3c3c3c] text-amber-300 px-1 py-0.2 rounded"
                            title="Host"
                          >
                            👑
                          </span>
                        )}
                        <span
                          className={`w-2 h-2 rounded-full ${
                            u.status === 'active' ? 'bg-[#00c985]' : 'bg-[#666666]'
                          }`}
                          title={u.status}
                        ></span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* PANEL 3: REAL-TIME CHAT */}
            {(activeNav === 'all' || activeNav === 'chat') && (
              <div className="p-3 flex-1 flex flex-col min-h-[220px]">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-bold text-[#858585] uppercase tracking-wider">
                    IN-ROOM CHAT
                  </span>
                  <span className="text-[10px] text-[#858585]">Yjs Sync</span>
                </div>

                {/* Chat Log Container */}
                <div className="flex-1 bg-[#1e1e1e] border border-[#2b2b2b] rounded p-2 overflow-y-auto space-y-2 text-xs font-sans max-h-60 mb-2">
                  {chatMessages.length === 0 ? (
                    <div className="text-[#666666] italic text-[11px] text-center py-6">
                      No messages yet. Send a message to start chatting!
                    </div>
                  ) : (
                    chatMessages.map((msg, index) => (
                      <div key={msg.id || index} className="flex flex-col gap-0.5">
                        <div className="flex items-center justify-between text-[10px]">
                          <span
                            className={`font-bold ${
                              msg.sender === username ? 'text-[#00c985]' : 'text-[#007acc]'
                            }`}
                          >
                            {msg.sender === username ? 'You' : msg.sender}:
                          </span>
                          <span className="text-[#666666]">{msg.time}</span>
                        </div>
                        <div className="text-[#cccccc] bg-[#2d2d2d] px-2 py-1 rounded border border-[#3c3c3c] break-words leading-relaxed text-[11px]">
                          {msg.text}
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Chat Input */}
                <form onSubmit={handleSendMessage} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="Type message..."
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 bg-[#1e1e1e] border border-[#3c3c3c] rounded text-xs text-white placeholder-[#666666] focus:outline-none focus:border-[#007acc] transition font-sans"
                  />
                  <button
                    type="submit"
                    className="bg-[#007acc] hover:bg-[#005fb8] text-white px-3 py-1.5 rounded font-bold text-xs transition"
                  >
                    Send
                  </button>
                </form>
              </div>
            )}
          </div>
        </aside>

        {/* CENTER MONACO EDITOR + VS CODE TERMINAL PANEL */}
        <section className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e] overflow-hidden">
          {/* EDITOR TABS BAR */}
          <div className="h-9 bg-[#252526] border-b border-[#2b2b2b] flex items-center justify-between px-2">
            <div className="flex items-center">
              <div className="h-9 bg-[#1e1e1e] border-t-2 border-[#007acc] border-r border-[#2b2b2b] px-3.5 flex items-center gap-2 text-xs font-mono text-white">
                <span className="text-[#00c985] font-bold">C++</span>
                <span>main.cpp</span>
                <span className="text-[#858585] text-[11px] hover:text-white cursor-pointer ml-1">
                  ✕
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-[#858585] font-mono pr-2">
              <span>C++ (g++)</span>
            </div>
          </div>

          {/* EDITOR BREADCRUMB BAR */}
          <div className="h-6 bg-[#1e1e1e] border-b border-[#2b2b2b] px-4 flex items-center text-[11px] text-[#858585] font-mono gap-1">
            <span>src</span>
            <span>&gt;</span>
            <span className="text-[#cccccc]">main.cpp</span>
            <span>&gt;</span>
            <span className="text-[#9cdcfe]">main()</span>
          </div>

          {/* MONACO EDITOR COMPONENT */}
          <div className="flex-1 overflow-hidden relative">
            <Editor
              height="100%"
              defaultLanguage="cpp"
              defaultValue=""
              theme="vs-dark"
              onMount={handleMount}
              options={{
                fontSize: 14,
                fontFamily: 'Consolas, "Fira Code", Monaco, monospace',
                minimap: { enabled: true },
                smoothScrolling: true,
                cursorBlinking: 'smooth',
                lineNumbers: 'on',
                glyphMargin: false,
                folding: true,
                lineDecorationsWidth: 10,
                lineNumbersMinChars: 3
              }}
            />
          </div>

          {/* BOTTOM VS CODE TERMINAL / OUTPUT PANEL */}
          <div className="h-44 bg-[#1e1e1e] border-t border-[#2b2b2b] flex flex-col font-mono text-xs overflow-hidden">
            {/* Panel Tab Header */}
            <div className="h-8 bg-[#252526] border-b border-[#2b2b2b] px-3 flex items-center justify-between text-[11px] text-[#858585]">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setActiveBottomTab('terminal')}
                  className={`py-1 ${
                    activeBottomTab === 'terminal'
                      ? 'text-white border-b-2 border-[#007acc] font-bold'
                      : 'hover:text-[#cccccc]'
                  }`}
                >
                  TERMINAL
                </button>
                <button
                  onClick={() => setActiveBottomTab('output')}
                  className={`py-1 ${
                    activeBottomTab === 'output'
                      ? 'text-white border-b-2 border-[#007acc] font-bold'
                      : 'hover:text-[#cccccc]'
                  }`}
                >
                  OUTPUT CONSOLE
                </button>
              </div>

              <div className="flex items-center gap-3">
                {output && (
                  <button
                    onClick={() => setOutput('')}
                    className="hover:text-white text-[10px]"
                    title="Clear Terminal Output"
                  >
                    🗑️ Clear
                  </button>
                )}
              </div>
            </div>

            {/* Terminal Body */}
            <div className="flex-1 p-3 overflow-y-auto bg-[#1e1e1e] text-[#cccccc] font-mono leading-relaxed text-xs">
              <div className="text-[#007acc] font-bold mb-1">
                codemesh@studio:~/room-{roomId}$ g++ -O2 main.cpp -o main &amp;&amp; ./main
              </div>
              <pre className="text-[#4ec9b0] whitespace-pre-wrap font-mono">
                {output || 'Press "▶ Run Code" (or ⌘+R) to compile and execute your C++ program.'}
              </pre>
            </div>
          </div>
        </section>
      </div>

      {/* 3. VS CODE BOTTOM STATUS BAR */}
      <footer className="h-6 bg-[#007acc] text-white px-3 flex items-center justify-between text-[11px] font-mono shrink-0 select-none">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1 font-bold">
            <span></span> main*
          </span>
          <span className="flex items-center gap-1 text-emerald-200">
            <span>✓</span> Yjs Live Sync
          </span>
          <span>Room: {roomId}</span>
        </div>

        <div className="flex items-center gap-4">
          <span>Ln 1, Col 1</span>
          <span>Spaces: 4</span>
          <span>UTF-8</span>
          <span>C++ (g++)</span>
          <span className="bg-black/20 px-1.5 py-0.2 rounded">
            👥 {activeUsersCount} Online
          </span>
        </div>
      </footer>
    </main>
  )
}

export default App