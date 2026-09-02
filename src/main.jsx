import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { StoreProvider } from './lib/store.jsx'
import './styles.css'

// One render error anywhere shows a readable card instead of a blank page.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error) {
    console.error('FLOP Toolkit crashed:', error)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ maxWidth: 640, margin: '15vh auto', padding: 20, fontFamily: 'monospace' }}>
          <h2 style={{ color: '#ff6b81' }}>Something broke</h2>
          <p style={{ color: '#9fb0d8' }}>{String(this.state.error.message || this.state.error)}</p>
          <button onClick={() => { this.setState({ error: null }); location.reload() }}>
            Reload the app
          </button>
          <p style={{ color: '#9fb0d8', fontSize: 12 }}>
            Your data is safe in localStorage — the Backup tab exports it after reload.
          </p>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <StoreProvider>
        <App />
      </StoreProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
