import { useState, useEffect } from 'react'
import { Login } from './components/Login'
import { Terminal } from './components/Terminal'
import { checkAuthStatus } from './services/api'

function App() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)

  useEffect(() => {
    checkAuthStatus().then(setLoggedIn)
  }, [])

  if (loggedIn === null) return null
  return loggedIn ? <Terminal onLogout={() => setLoggedIn(false)} /> : <Login />
}

export default App
