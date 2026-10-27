import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '@blossom-carousel/react/style.css'
import App from './App.tsx'
import { android } from './lib/android'
import { installSpatialNavigation } from './lib/spatialNav'

// Android app (TV boxes): move with the remote's arrows. Anywhere else,
// ?remote=1 turns it on for this browser (handy to test with a keyboard).
function remoteWanted() {
  try {
    const flag = new URLSearchParams(location.search).get('remote')
    if (flag !== null) localStorage.setItem('ap_remote', flag === '0' ? '0' : '1')
    return localStorage.getItem('ap_remote') === '1'
  } catch {
    return false
  }
}
if (android || remoteWanted()) installSpatialNavigation()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
