import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import forge from 'node-forge'
import { WebSocketServer } from 'ws'

const MAX_FRAME_BYTES = 3 * 1024 * 1024
const FIRST_PORT = 8787
const LAST_PORT = 8798
const CERT_DAYS = 825
const CA_DAYS = 3650

function lanAddresses() {
  const found = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      if (entry.address.startsWith('169.254.')) continue
      found.push(entry.address)
    }
  }
  const unique = [...new Set(found)]
  unique.sort((a, b) => {
    const virtual = (ip) => (ip.startsWith('192.168.56.') ? 1 : 0)
    return virtual(a) - virtual(b)
  })
  return unique
}

function certFiles(dir) {
  return {
    caCert: path.join(dir, 'ca-cert.pem'),
    caKey: path.join(dir, 'ca-key.pem'),
    leafCert: path.join(dir, 'leaf-cert.pem'),
    leafKey: path.join(dir, 'leaf-key.pem'),
    san: path.join(dir, 'leaf-san.json'),
  }
}

const serial = (prefix) => prefix + crypto.randomBytes(15).toString('hex')

function createAuthority() {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = serial('01')
  cert.validity.notBefore = new Date(Date.now() - 86_400_000)
  cert.validity.notAfter = new Date(Date.now() + CA_DAYS * 86_400_000)
  const subject = [
    { name: 'commonName', value: 'ZenDev local camera CA' },
    { name: 'organizationName', value: 'ZenDev' },
  ]
  cert.setSubject(subject)
  cert.setIssuer(subject)
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return { cert, privateKey: keys.privateKey }
}

function createLeaf(authority, addresses) {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = serial('02')
  cert.validity.notBefore = new Date(Date.now() - 86_400_000)
  cert.validity.notAfter = new Date(Date.now() + CERT_DAYS * 86_400_000)
  cert.setSubject([{ name: 'commonName', value: 'zendev.local' }])
  cert.setIssuer(authority.cert.subject.attributes)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
        ...addresses.map((ip) => ({ type: 7, ip })),
      ],
    },
    { name: 'subjectKeyIdentifier' },
  ])
  cert.sign(authority.privateKey, forge.md.sha256.create())
  return { cert, privateKey: keys.privateKey }
}

function readAuthority(dir) {
  const files = certFiles(dir)
  if (!fs.existsSync(files.caCert) || !fs.existsSync(files.caKey)) return null
  try {
    const cert = forge.pki.certificateFromPem(fs.readFileSync(files.caCert, 'utf8'))
    const privateKey = forge.pki.privateKeyFromPem(fs.readFileSync(files.caKey, 'utf8'))
    if (cert.validity.notAfter.getTime() < Date.now() + 7 * 86_400_000) return null
    return { cert, privateKey }
  } catch {
    return null
  }
}

function ensureAuthority(dir) {
  const existing = readAuthority(dir)
  if (existing) return existing
  const authority = createAuthority()
  const files = certFiles(dir)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(files.caCert, forge.pki.certificateToPem(authority.cert), 'utf8')
  fs.writeFileSync(files.caKey, forge.pki.privateKeyToPem(authority.privateKey), 'utf8')
  return authority
}

function ensureLeaf(dir, authority, addresses) {
  const files = certFiles(dir)
  const wanted = JSON.stringify(addresses)
  if (fs.existsSync(files.leafCert) && fs.existsSync(files.leafKey) && fs.existsSync(files.san)) {
    try {
      const recorded = fs.readFileSync(files.san, 'utf8')
      const cert = forge.pki.certificateFromPem(fs.readFileSync(files.leafCert, 'utf8'))
      const privateKey = forge.pki.privateKeyFromPem(fs.readFileSync(files.leafKey, 'utf8'))
      const valid = cert.validity.notAfter.getTime() > Date.now() + 14 * 86_400_000
      if (recorded === wanted && valid) return { cert, privateKey }
    } catch {
      // fall through and reissue
    }
  }
  const leaf = createLeaf(authority, addresses)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(files.leafCert, forge.pki.certificateToPem(leaf.cert), 'utf8')
  fs.writeFileSync(files.leafKey, forge.pki.privateKeyToPem(leaf.privateKey), 'utf8')
  fs.writeFileSync(files.san, wanted, 'utf8')
  return leaf
}

async function loadCertificate(dir, addresses) {
  const authority = ensureAuthority(dir)
  const leaf = ensureLeaf(dir, authority, addresses)
  return {
    cert: forge.pki.certificateToPem(leaf.cert),
    key: forge.pki.privateKeyToPem(leaf.privateKey),
    caDer: Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(authority.cert)).getBytes(), 'binary'),
    caFingerprint: forge.md.sha256
      .create()
      .update(forge.asn1.toDer(forge.pki.certificateToAsn1(authority.cert)).getBytes())
      .digest()
      .toHex()
      .match(/.{1,2}/g)
      .join(':')
      .toUpperCase(),
  }
}

function listenOn(server, first, last) {
  return (async () => {
    for (let port = first; port <= last; port += 1) {
      try {
        await new Promise((resolve, reject) => {
          const onError = (error) => {
            server.off('listening', onListening)
            reject(error)
          }
          const onListening = () => {
            server.off('error', onError)
            resolve()
          }
          server.once('error', onError)
          server.once('listening', onListening)
          server.listen(port, '0.0.0.0')
        })
        return port
      } catch (error) {
        if (error?.code !== 'EADDRINUSE' || port === last) throw error
      }
    }
    throw new Error('No free port for the phone bridge.')
  })()
}

function page() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0f14">
<title>ZenDev camera</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100dvh; display: flex; flex-direction: column;
    background: #0b0f14; color: #e7edf5;
    font: 15px/1.5 "Segoe UI", system-ui, sans-serif;
  }
  header { padding: 18px 20px 8px; }
  h1 { margin: 0; font-size: 20px; letter-spacing: -0.01em; }
  .sub { margin: 4px 0 0; color: #96a5b6; font-size: 13px; }
  main { flex: 1; padding: 12px 20px 24px; display: flex; flex-direction: column; gap: 14px; }
  .frame {
    position: relative; border-radius: 14px; overflow: hidden;
    background: #000; aspect-ratio: 16 / 9; border: 1px solid #1d2833;
  }
  video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .badge {
    position: absolute; left: 10px; top: 10px;
    padding: 3px 8px; border-radius: 999px; font-size: 11px; letter-spacing: .08em;
    background: rgba(8,12,17,.75); border: 1px solid #2a3a4a; text-transform: uppercase;
  }
  .badge.live { color: #7ef0b2; border-color: #2c5f47; }
  .badge.wait { color: #ffd08a; border-color: #6b5227; }
  .row { display: flex; gap: 10px; align-items: center; }
  button, .button {
    flex: 1; padding: 13px 16px; border-radius: 11px; font: inherit; font-weight: 600;
    color: #06121a; background: #8fe3c2; border: 0; text-align: center; text-decoration: none;
  }
  button.ghost, .button.ghost { background: transparent; color: #cfe0ef; border: 1px solid #2a3a4a; }
  p { margin: 0; color: #96a5b6; font-size: 13px; }
  .status { font-variant-numeric: tabular-nums; }
  code { color: #cfe0ef; }
</style>
</head>
<body>
<header>
  <h1>ZenDev camera</h1>
  <p class="sub">Your phone becomes the sensor. Frames go straight to the app on your computer.</p>
</header>
<main>
  <div class="frame">
    <video id="preview" playsinline muted autoplay></video>
    <span id="badge" class="badge wait">starting</span>
  </div>
  <div class="row">
    <button id="flip" class="ghost" type="button">Flip camera</button>
    <button id="restart" class="ghost" type="button">Restart</button>
  </div>
  <p id="status" class="status">Waiting for camera permission.</p>
  <p>Keep this tab open and the screen awake. Nothing is recorded or uploaded: JPEG frames go over your own Wi-Fi to the desktop app only.</p>
</main>
<script>
const token = location.pathname.split('/').filter(Boolean)[1] || ''
const video = document.getElementById('preview')
const badge = document.getElementById('badge')
const statusEl = document.getElementById('status')
const WIDTH = 1280
const HEIGHT = 720
const FPS = 30
const QUALITY = 0.8

let ws = null
let stream = null
let facing = 'user'
let timer = null
let sending = false
let frames = 0
let wakeLock = null

const canvas = document.createElement('canvas')
canvas.width = WIDTH
canvas.height = HEIGHT
const ctx = canvas.getContext('2d', { willReadFrequently: true })

function setStatus(text, live) {
  statusEl.textContent = text
  badge.textContent = live ? 'live' : 'starting'
  badge.className = live ? 'badge live' : 'badge wait'
}

function connect() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(scheme + '://' + location.host + '/c/' + token + '/ws')
  ws.binaryType = 'arraybuffer'
  ws.addEventListener('open', () => {
    if (stream) setStatus('Streaming to ZenDev', true)
  })
  ws.addEventListener('close', () => {
    setStatus('Connection closed. Reconnecting...', false)
    setTimeout(connect, 1500)
  })
  ws.addEventListener('error', () => {
    badge.className = 'badge wait'
    badge.textContent = 'offline'
  })
}

async function startCamera() {
  if (stream) {
    for (const track of stream.getTracks()) track.stop()
    stream = null
  }
  const constraints = {
    audio: false,
    video: {
      facingMode: facing,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
  }
  stream = await navigator.mediaDevices.getUserMedia(constraints)
  video.srcObject = stream
  await video.play()
  const settings = stream.getVideoTracks()[0].getSettings()
  setStatus(describeTrack(settings) + ' - starting stream', false)

  if ('wakeLock' in navigator) {
    try { wakeLock = await navigator.wakeLock.request('screen') } catch {}
  }
}

function describeTrack(settings) {
  return (settings.width || '?') + 'x' + (settings.height || '?')
}

function drawFrameInto() {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return
  const scale = Math.min(WIDTH / vw, HEIGHT / vh)
  const dw = vw * scale
  const dh = vh * scale
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  ctx.drawImage(video, (WIDTH - dw) / 2, (HEIGHT - dh) / 2, dw, dh)
}

function tick() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !stream || video.readyState < 2) return
  if (sending || ws.bufferedAmount > 512 * 1024) return
  sending = true
  drawFrameInto()
  canvas.toBlob(async (blob) => {
    try {
      if (blob && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(await blob.arrayBuffer())
        frames += 1
        if (frames === 1 || frames % 60 === 0) {
          setStatus('Streaming to ZenDev - ' + frames + ' frames', true)
        }
      }
    } finally {
      sending = false
    }
  }, 'image/jpeg', QUALITY)
}

document.getElementById('flip').addEventListener('click', async () => {
  facing = facing === 'user' ? 'environment' : 'user'
  await startCamera()
})

document.getElementById('restart').addEventListener('click', async () => {
  try { await startCamera() } catch (error) { setStatus(error.message, false) }
})

if (!navigator.mediaDevices) {
  setStatus('This page needs a secure connection. Open the pairing page and install the certificate once.', false)
} else {
  connect()
  startCamera().catch((error) => {
    setStatus('Camera blocked: ' + error.message, false)
  })
  timer = setInterval(tick, Math.round(1000 / FPS))
}

window.addEventListener('pagehide', () => {
  clearInterval(timer)
  if (ws) ws.close()
  if (stream) for (const track of stream.getTracks()) track.stop()
  if (wakeLock) wakeLock.release().catch(() => {})
})
</script>
</body>
</html>`
}

function pairPage({ cameraUrl, fingerprint }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0f14">
<title>ZenDev pairing</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100dvh; background: #0b0f14; color: #e7edf5;
    font: 15px/1.55 "Segoe UI", system-ui, sans-serif;
  }
  .wrap { max-width: 620px; margin: 0 auto; padding: 22px 20px 40px; }
  h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: -0.01em; }
  .sub { margin: 0 0 22px; color: #96a5b6; font-size: 13.5px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .14em; color: #96a5b6; margin: 26px 0 8px; }
  ol { margin: 0; padding-left: 20px; }
  li { margin: 7px 0; }
  .button {
    display: block; padding: 14px 18px; border-radius: 12px; font-weight: 700;
    color: #06121a; background: #8fe3c2; text-decoration: none; text-align: center;
    margin: 10px 0 6px;
  }
  .button.ghost { background: transparent; color: #cfe0ef; border: 1px solid #2a3a4a; }
  code { color: #cfe0ef; font-size: 12.5px; word-break: break-all; }
  .note {
    margin-top: 18px; padding: 12px 14px; border-radius: 10px;
    border: 1px solid #1d2833; background: #0f151c; color: #96a5b6; font-size: 12.5px;
  }
  .fp { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: #6f8093; word-break: break-all; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Pair your phone camera</h1>
  <p class="sub">One-time setup. The certificate is generated on your computer and only names this machine.</p>

  <h2>1. Download the local certificate</h2>
  <a class="button" href="/ca.crt">Download ZenDev CA certificate</a>
  <p class="fp">SHA-256 ${fingerprint}</p>

  <h2>2. Install it on this phone</h2>
  <ol>
    <li><b>Android:</b> Settings → Security &amp; privacy → More security settings → Encryption &amp; credentials → Install a certificate → CA certificate → Install anyway → pick the downloaded file.</li>
    <li><b>iPhone:</b> allow the profile download, then Settings → General → VPN &amp; Device Management → install it, then Settings → General → About → Certificate Trust Settings → enable full trust.</li>
  </ol>

  <h2>3. Open the camera</h2>
  <a class="button ghost" href="${cameraUrl}">Open the camera page</a>
  <p>Still showing a warning? Open <code>${cameraUrl}</code> in Chrome or Safari directly, not inside a chat app, then choose Advanced → Proceed.</p>

  <div class="note">
    The camera page and the pair page are served by your own computer over your Wi-Fi.
    Frames never leave the local network, and the app stores nothing until you export it.
  </div>
</div>
</body>
</html>`
}

export async function startPhoneBridge({ userData, onFrame, onClients }) {
  const token = crypto.randomBytes(9).toString('hex')
  const addresses = lanAddresses()
  const { cert, key, caDer, caFingerprint } = await loadCertificate(path.join(userData, 'phone'), addresses)
  const clients = new Set()

  const handle = (request, response) => {
    const url = new URL(request.url ?? '/', 'https://zendev.local')
    const parts = url.pathname.split('/').filter(Boolean)

    if (parts[0] === 'c' && parts[1] === token && parts.length === 2) {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end(page())
      return
    }

    if (parts[0] === 'pair' && parts[1] === token && parts.length === 2) {
      const host = (request.headers.host ?? '').split(':')[0] || 'localhost'
      const cameraUrl = `https://${host}:${httpsPort}/c/${token}`
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end(pairPage({ cameraUrl, fingerprint: caFingerprint }))
      return
    }

    if (url.pathname === '/ca.crt') {
      response.writeHead(200, {
        'content-type': 'application/x-x509-ca-cert',
        'content-disposition': 'attachment; filename="zendev-ca.crt"',
        'content-length': caDer.length,
        'cache-control': 'no-store',
      })
      response.end(caDer)
      return
    }

    if (url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('ZenDev camera bridge. Open the pairing link shown in the app.\n')
      return
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found\n')
  }

  let httpsPort = FIRST_PORT
  let httpPort = FIRST_PORT + 1

  const httpsServer = https.createServer({ cert, key }, handle)
  const httpServer = http.createServer(handle)

  httpsPort = await listenOn(httpsServer, FIRST_PORT, LAST_PORT)
  httpPort = await listenOn(httpServer, httpPort, LAST_PORT + 1)

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES })

  const upgrade = (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'https://zendev.local')
    if (url.pathname !== `/c/${token}/ws`) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      clients.add(ws)
      onClients?.(clients.size)
      ws.on('message', (data, isBinary) => {
        if (!isBinary) return
        const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data)
        if (bytes.length > MAX_FRAME_BYTES) return
        onFrame?.(new Uint8Array(bytes))
      })
      const drop = () => {
        clients.delete(ws)
        onClients?.(clients.size)
      }
      ws.on('close', drop)
      ws.on('error', drop)
    })
  }

  httpsServer.on('upgrade', upgrade)
  httpServer.on('upgrade', upgrade)

  const urls = addresses.map((ip) => `https://${ip}:${httpsPort}/c/${token}`)
  const pairUrls = addresses.map((ip) => `http://${ip}:${httpPort}/pair/${token}`)
  const url = urls[0] ?? `https://localhost:${httpsPort}/c/${token}`
  const pairUrl = pairUrls[0] ?? `http://localhost:${httpPort}/pair/${token}`

  return {
    port: httpsPort,
    httpPort,
    token,
    url,
    urls,
    pairUrl,
    pairUrls,
    addresses,
    fingerprint: caFingerprint,
    clients: () => clients.size,
    close: () =>
      new Promise((resolve) => {
        for (const ws of clients) {
          try {
            ws.terminate()
          } catch {
            // already gone
          }
        }
        wss.close(() => {
          httpsServer.close(() => httpServer.close(() => resolve()))
        })
      }),
  }
}