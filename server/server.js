import express from 'express'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import cors from 'cors'
import RSSParser from 'rss-parser'
import os from 'os'
import querystring from 'querystring'
import multer from 'multer'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = 3000

// 数据文件路径
// 修改为 /app/server/data/data.json，方便 Docker 挂载目录
const DATA_DIR = path.join(__dirname, 'data')
const DATA_FILE = path.join(DATA_DIR, 'data.json')
const DEFAULT_FILE = path.join(__dirname, 'default.json')
const MUSIC_DIR = path.join(__dirname, 'music')

// 配置 multer 上传
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, MUSIC_DIR)
  },
  filename: function (req, file, cb) {
    // 尝试修复中文乱码问题
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8')
    cb(null, name)
  },
})
const upload = multer({ storage: storage })

// 确保数据目录存在
try {
  await fs.access(DATA_DIR)
} catch {
  await fs.mkdir(DATA_DIR, { recursive: true })
}
const CACHE_TTL_MS = 60 * 60 * 1000
const HOT_CACHE = { weibo: { ts: 0, data: [] }, news: { ts: 0, data: [] }, rss: new Map() }

// 内存缓存，避免频繁读盘
let cachedData = null

// 原子写入辅助函数
async function atomicWrite(filePath, content) {
  const tempFile = filePath + '.tmp'
  await fs.writeFile(tempFile, content)
  await fs.rename(tempFile, filePath)
}

// ------------------------------------------------------------------
// 全局中间件
// ------------------------------------------------------------------
app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true }))

// ------------------------------------------------------------------
// 初始化 data.json & music 目录
// ------------------------------------------------------------------
async function ensureInit() {
  try {
    await fs.access(DATA_FILE)
    // 启动时加载数据到内存
    const fileContent = await fs.readFile(DATA_FILE, 'utf-8')
    cachedData = JSON.parse(fileContent)
  } catch {
    try {
      const def = await fs.readFile(DEFAULT_FILE, 'utf-8')
      await fs.writeFile(DATA_FILE, def)
      cachedData = JSON.parse(def)
    } catch {
      const initData = {
        groups: [{ id: 'default', title: '常用', items: [] }],
        widgets: [],
        appConfig: {},
        password: 'admin',
      }
      await fs.writeFile(DATA_FILE, JSON.stringify(initData, null, 2))
      cachedData = initData
    }
  }

  try {
    await fs.access(MUSIC_DIR)
  } catch {
    await fs.mkdir(MUSIC_DIR, { recursive: true })
  }
}

ensureInit()

// ------------------------------------------------------------------
// 读取配置
// ------------------------------------------------------------------
app.get('/api/data', async (req, res) => {
  try {
    // 移除强制禁用缓存的 headers，允许 ETag 生效
    // 如果内存中没有数据（异常情况），尝试重新读取
    if (!cachedData) {
      const json = await fs.readFile(DATA_FILE, 'utf-8')
      cachedData = JSON.parse(json)
    }

    // 修复 Ping 请求数据泄露：如果是 ping 请求，只返回简单状态，不返回数据文件
    if (req.query.ping) {
      return res.json({ success: true, ts: Date.now() })
    }

    // 直接返回内存数据
    res.json(cachedData)
  } catch (err) {
    console.error('[读取配置失败]:', err)
    res.status(500).json({ error: 'Failed to read data.json' })
  }
})

// ------------------------------------------------------------------
// 保存配置
// ------------------------------------------------------------------
app.post('/api/save', async (req, res) => {
  console.log(`[Save] Received save request. Body size: ${JSON.stringify(req.body).length} chars`)
  try {
    const body = req.body
    if (!body || Object.keys(body).length === 0) {
      console.warn('[Save] Empty body received, skipping save.')
      return res.status(400).json({ error: 'Empty body' })
    }

    // 更新内存缓存
    cachedData = body
    // 原子写入
    await atomicWrite(DATA_FILE, JSON.stringify(body, null, 2))

    console.log('[Save] Successfully wrote to data.json')
    res.json({ success: true })
  } catch (err) {
    console.error('[保存配置失败]:', err)
    res.status(500).json({ error: 'Failed to save config' })
  }
})

// ------------------------------------------------------------------
// PING 检测接口 (Linux/Windows)
// ------------------------------------------------------------------
app.get('/api/ping', async (req, res) => {
  const target = req.query.target || '223.5.5.5'

  // 简单的安全检查，防止命令注入 (仅允许 IP 或域名格式)
  if (!/^[a-zA-Z0-9.-]+$/.test(target)) {
    return res.status(400).json({ error: 'Invalid target' })
  }

  // 区分系统命令
  const isWin = os.platform() === 'win32'
  const cmd = isWin ? 'ping' : 'ping'
  const args = isWin
    ? ['-n', '1', '-w', '2000', target] // Windows: -n count, -w timeout(ms)
    : ['-c', '1', '-W', '2', target] // Linux: -c count, -W timeout(s)

  const start = performance.now()

  const proc = spawn(cmd, args)

  let output = ''

  proc.stdout.on('data', (data) => {
    output += data.toString()
  })

  proc.on('close', (code) => {
    const end = performance.now()
    // 如果 ping 命令执行成功 (code 0)，我们尝试解析输出中的时间，或者直接使用后端执行时间作为近似值
    // Windows output: "time=12ms" or "时间=12ms"
    // Linux output: "time=12.3 ms"

    if (code === 0) {
      let latency = Math.round(end - start) // Fallback: total execution time

      // 尝试从输出中解析更准确的 ping 值
      const match = output.match(/time[=<]([\d\.]+) ?ms/i) || output.match(/时间[=<]([\d\.]+) ?ms/)
      if (match && match[1]) {
        latency = Math.round(parseFloat(match[1]))
      }

      res.json({ success: true, latency: latency + 'ms', target })
    } else {
      res.json({ success: false, latency: 'Timeout', target })
    }
  })

  proc.on('error', (err) => {
    console.error('Ping error:', err)
    res.json({ success: false, latency: 'Error', target })
  })
})

// ------------------------------------------------------------------
// IP 检测代理接口 (解决前端 CORS 问题)
// ------------------------------------------------------------------
app.get('/api/ip', async (req, res) => {
  // 获取客户端真实 IP (尝试从 X-Forwarded-For 或 socket 获取)
  let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''
  // 清理 IPv6 映射前缀
  if (clientIp.startsWith('::ffff:')) {
    clientIp = clientIp.substring(7)
  }
  // 如果有多个 IP (X-Forwarded-For)，取第一个
  if (clientIp.includes(',')) {
    clientIp = clientIp.split(',')[0].trim()
  }

  const sources = [
    { url: 'https://whois.pconline.com.cn/ipJson.jsp?json=true', type: 'pconline' },
    { url: 'https://qifu-api.baidubce.com/ip/local/geo/v1/district', type: 'baidu' },
    { url: 'https://ipapi.co/json/', type: 'ipapi' },
  ]

  for (const s of sources) {
    try {
      // Node.js fetch (requires Node 18+)
      const r = await fetch(s.url)
      if (!r.ok) continue

      const buffer = await r.arrayBuffer()
      const decoder = new TextDecoder(s.type === 'pconline' ? 'gbk' : 'utf-8')
      const text = decoder.decode(buffer)

      // Clean up any potential JS wrapper from PCOnline if it returns script even with json=true (sometimes it does)
      // But with json=true it usually returns pure JSON but in GBK.
      // Sometimes it returns `IPCallBack({...});` if callback param is set, but we didn't set it.
      // Just parse JSON.
      let data
      try {
        data = JSON.parse(text.trim())
      } catch {
        // simple retry or fallback
        continue
      }

      let ip = '',
        location = ''

      if (s.type === 'pconline') {
        ip = data.ip
        location = data.addr || data.pro + data.city
      } else if (s.type === 'baidu') {
        ip = data.ip
        location = data.data?.prov + ' ' + data.data?.city
      } else if (s.type === 'ipapi') {
        ip = data.ip
        location = data.city
      }

      if (ip) {
        return res.json({ success: true, ip, location, source: s.type, clientIp })
      }
    } catch (e) {
      console.warn(`[IP Proxy] Failed to fetch from ${s.type}:`, e.message)
    }
  }

  // Fallback: try to get IP from request socket if all externals fail
  res.json({ success: false, ip: clientIp, location: 'Unknown', source: 'fallback', clientIp })
})

// ------------------------------------------------------------------
// 导入配置
// ------------------------------------------------------------------
app.post('/api/data', async (req, res) => {
  try {
    const body = req.body
    cachedData = body
    await atomicWrite(DATA_FILE, JSON.stringify(body, null, 2))
    res.json({ success: true })
  } catch (err) {
    console.error('[导入配置失败]:', err)
    res.status(500).json({ error: 'Failed to import data' })
  }
})

app.post('/api/reset', async (req, res) => {
  try {
    try {
      const def = await fs.readFile(DEFAULT_FILE, 'utf-8')
      cachedData = JSON.parse(def)
      await atomicWrite(DATA_FILE, def)
    } catch {
      const init = {
        groups: [{ id: 'g1', title: '常用', items: [] }],
        widgets: [
          { id: 'w1', type: 'clock', enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
          { id: 'w2', type: 'weather', enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
          { id: 'w3', type: 'calendar', enable: true, colSpan: 1, rowSpan: 1, isPublic: true },
          {
            id: 'w4',
            type: 'memo',
            enable: true,
            data: '',
            colSpan: 1,
            rowSpan: 1,
            isPublic: false,
          },
          { id: 'w5', type: 'search', enable: true, isPublic: true },
          {
            id: 'w6',
            type: 'bookmarks',
            enable: true,
            data: [],
            colSpan: 1,
            rowSpan: 2,
            isPublic: false,
          },
          { id: 'w7', type: 'quote', enable: true, isPublic: true },
          {
            id: 'w8',
            type: 'todo',
            enable: true,
            data: [],
            colSpan: 1,
            rowSpan: 1,
            isPublic: false,
          },
          { id: 'w9', type: 'calculator', enable: false, colSpan: 1, rowSpan: 1, isPublic: true },
          { id: 'w10', type: 'ip', enable: false, colSpan: 1, rowSpan: 1, isPublic: false },
          {
            id: 'w11',
            type: 'iframe',
            enable: false,
            data: { url: '' },
            colSpan: 2,
            rowSpan: 2,
            isPublic: true,
          },
          { id: 'player', type: 'player', enable: true, isPublic: true },
          {
            id: 'hot-list',
            type: 'hot',
            enable: true,
            colSpan: 1,
            rowSpan: 2,
            isPublic: true,
            data: { rssUrl: 'https://www.v2ex.com/feed/' },
          },
          {
            id: 'clockweather',
            type: 'clockweather',
            enable: true,
            colSpan: 1,
            rowSpan: 1,
            isPublic: true,
          },
          { id: 'rss-reader', type: 'rss', enable: false, colSpan: 1, rowSpan: 2, isPublic: true },
        ],
        appConfig: {
          background: '',
          customTitle: '我的导航',
          titleAlign: 'left',
          titleSize: 48,
          titleColor: '#ffffff',
          cardLayout: 'vertical',
          cardSize: 120,
          gridGap: 24,
          cardBgColor: 'rgba(255, 255, 255, 0.8)',
          cardTitleColor: '#111827',
          cardBorderColor: 'transparent',
          showCardBackground: true,
          iconShape: 'rounded',
        },
        password: 'admin',
      }
      cachedData = init
      await atomicWrite(DATA_FILE, JSON.stringify(init, null, 2))
    }
    res.json({ success: true })
  } catch (err) {
    console.error('[恢复初始化失败]:', err)
    res.status(500).json({ error: 'Failed to reset to defaults' })
  }
})

// 将当前配置保存为默认模板
app.post('/api/default/save', async (req, res) => {
  try {
    const cur = await fs.readFile(DATA_FILE, 'utf-8')
    await fs.writeFile(DEFAULT_FILE, cur)
    res.json({ success: true })
  } catch (err) {
    console.error('[保存默认模板失败]:', err)
    res.status(500).json({ error: 'Failed to save default template' })
  }
})

const rssParser = new RSSParser()

// ------------------------------------------------------------------
// 微博热搜
// ------------------------------------------------------------------
app.get('/api/hot/weibo', async (req, res) => {
  console.log('GET /api/hot/weibo')
  try {
    const force = req.query.force === '1'
    if (!force && HOT_CACHE.weibo.data.length && Date.now() - HOT_CACHE.weibo.ts < CACHE_TTL_MS) {
      return res.json(HOT_CACHE.weibo.data)
    }
    const r = await fetch('https://weibo.com/ajax/side/hotSearch', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://weibo.com/',
      },
    })
    const text = await r.text()
    if (!r.ok)
      return res.status(r.status).json({ error: 'upstream_error', status: r.status, body: text })
    let j
    try {
      j = JSON.parse(text)
    } catch {
      return res.status(502).json({ error: 'invalid_json', body: text.slice(0, 500) })
    }
    const arr = Array.isArray(j?.data?.realtime) ? j.data.realtime : []
    const items = arr.map((x) => ({
      title: x.word || x.note || '',
      url: 'https://s.weibo.com/weibo?q=' + encodeURIComponent(x.word || x.note || ''),
      hot: x.num || x.rank || '',
    }))
    HOT_CACHE.weibo = { ts: Date.now(), data: items }
    res.json(items)
  } catch (err) {
    if (HOT_CACHE.weibo.data.length) return res.json(HOT_CACHE.weibo.data)
    res.status(500).json({ error: String(err) })
  }
})

// ------------------------------------------------------------------
// 中国新闻网
// ------------------------------------------------------------------
app.get('/api/hot/news', async (req, res) => {
  console.log('GET /api/hot/news')
  try {
    const force = req.query.force === '1'
    if (!force && HOT_CACHE.news.data.length && Date.now() - HOT_CACHE.news.ts < CACHE_TTL_MS) {
      return res.json(HOT_CACHE.news.data)
    }
    const feed = await rssParser.parseURL('https://www.chinanews.com.cn/rss/scroll-news.xml')
    const items = (feed.items || []).slice(0, 50).map((i) => {
      let timeStr = ''
      if (i.pubDate) {
        try {
          const d = new Date(i.pubDate)
          if (!isNaN(d.getTime())) {
            const mon = String(d.getMonth() + 1).padStart(2, '0')
            const day = String(d.getDate()).padStart(2, '0')
            const h = String(d.getHours()).padStart(2, '0')
            const m = String(d.getMinutes()).padStart(2, '0')
            timeStr = `${mon}-${day} ${h}:${m}`
          } else {
            timeStr = i.pubDate.slice(0, 16)
          }
        } catch {
          timeStr = ''
        }
      }
      return {
        title: i.title || '',
        url: i.link || '',
        hot: timeStr,
      }
    })
    HOT_CACHE.news = { ts: Date.now(), data: items }
    res.json(items)
  } catch (err) {
    console.error('Fetch news failed:', err)
    if (HOT_CACHE.news.data.length) return res.json(HOT_CACHE.news.data)
    res.status(502).json({ error: '获取新闻失败: ' + String(err.message || err) })
  }
})

// ------------------------------------------------------------------
// GitHub 热搜
// ------------------------------------------------------------------
app.get('/api/hot/github', async (req, res) => {
  console.log('GET /api/hot/github', req.query)
  try {
    const url = typeof req.query.url === 'string' ? req.query.url : ''
    if (!url) return res.status(400).json({ error: 'rss_url_required' })
    const force = req.query.force === '1'
    const entry = HOT_CACHE.rss.get(url)
    if (!force && entry && Date.now() - entry.ts < CACHE_TTL_MS) {
      return res.json(entry.data)
    }
    const feed = await rssParser.parseURL(url)
    const items = (feed.items || []).map((i) => ({
      title: i.title || '',
      url: i.link || '',
      hot: i.isoDate || i.pubDate || '',
    }))
    HOT_CACHE.rss.set(url, { ts: Date.now(), data: items })
    res.json(items)
  } catch (err) {
    const entry = HOT_CACHE.rss.get(String(req.query.url || ''))
    if (entry) return res.json(entry.data)
    res.status(500).json({ error: String(err) })
  }
})

// ------------------------------------------------------------------
// 网页元数据抓取
// ------------------------------------------------------------------
app.get('/api/fetch-meta', async (req, res) => {
  try {
    let url = req.query.url
    if (!url) return res.status(400).json({ error: 'Missing url' })

    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url
    }

    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      },
      redirect: 'follow',
    })

    if (!r.ok) throw new Error(`Status ${r.status}`)

    const html = await r.text()

    // 简单正则提取 Title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim() : ''

    // 简单正则提取 Icon
    let icon = ''
    const iconMatch = html.match(
      /<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["'][^>]*>/i,
    )
    if (iconMatch) {
      icon = iconMatch[1]
      // 处理相对路径
      if (icon && !/^https?:\/\//i.test(icon)) {
        try {
          icon = new URL(icon, url).href
        } catch {}
      }
    }

    // 如果没找到 icon，尝试默认路径
    if (!icon) {
      try {
        const u = new URL(url)
        icon = `${u.origin}/favicon.ico`
      } catch {}
    }

    res.json({ title, icon })
  } catch (err) {
    console.error('[Meta Fetch Error]:', err.message)
    res.status(500).json({ error: 'Failed to fetch meta' })
  }
})

// ------------------------------------------------------------------
// RSS 通用解析
// ------------------------------------------------------------------
app.get('/api/rss/parse', async (req, res) => {
  try {
    const url = typeof req.query.url === 'string' ? req.query.url : ''
    if (!url) return res.status(400).json({ error: 'rss_url_required' })
    const force = req.query.force === '1'
    const entry = HOT_CACHE.rss.get(url)
    if (!force && entry && Date.now() - entry.ts < CACHE_TTL_MS) {
      return res.json({ meta: entry.meta || {}, items: entry.data })
    }
    const feed = await rssParser.parseURL(url)
    const items = (feed.items || []).map((i) => ({
      title: i.title || '',
      url: i.link || '',
      hot: i.isoDate || i.pubDate || '',
    }))
    const meta = {
      title: feed.title || url,
      icon: (feed.image && (feed.image.url || feed.image.link)) || '',
    }
    HOT_CACHE.rss.set(url, { ts: Date.now(), data: items, meta })
    res.json({ meta, items })
  } catch (err) {
    const entry = HOT_CACHE.rss.get(String(req.query.url || ''))
    if (entry) return res.json({ meta: entry.meta || {}, items: entry.data })
    res.status(502).json({ error: String(err) })
  }
})

// ------------------------------------------------------------------
// 音乐列表
// ------------------------------------------------------------------
app.get('/api/music-list', async (req, res) => {
  try {
    const files = await fs.readdir(MUSIC_DIR)
    const list = files.filter((f) => /\.(mp3|flac|wav|m4a)$/i.test(f))
    res.json(list)
  } catch (err) {
    console.error('[音乐列表读取失败]:', err)
    res.status(500).json({ error: 'Failed to read music folder' })
  }
})

// ------------------------------------------------------------------
// 图标列表
// ------------------------------------------------------------------
app.get('/api/icons', async (req, res) => {
  try {
    // 优先查找 public/icons (开发环境)，如果不存在则查找 dist/icons (生产环境/Docker)
    let iconsDir = path.join(__dirname, '../public/icons')
    try {
      await fs.access(iconsDir)
    } catch {
      iconsDir = path.join(__dirname, '../dist/icons')
      try {
        await fs.access(iconsDir)
      } catch {
        return res.json([])
      }
    }

    const files = await fs.readdir(iconsDir)
    const list = files.filter((f) => /\.(png|jpg|jpeg|svg|ico|webp)$/i.test(f))
    res.json(list)
  } catch (err) {
    console.error('[图标列表读取失败]:', err)
    res.status(500).json({ error: 'Failed to read icons folder' })
  }
})

// ------------------------------------------------------------------
// CGI 处理器 (已修正：仅使用 node 调用)
// ------------------------------------------------------------------
app.all(/.*\.cgi(\/.*)?$/, (req, res) => {
  const cgiScript = path.join(__dirname, 'cgi-bin', 'index.cgi')
  console.log(`[CGI] Handling request: ${req.originalUrl} via ${cgiScript}`)

  // 准备 POST 数据
  let inputData = ''
  if (req.method === 'POST' && req.body) {
    if (req.is('application/x-www-form-urlencoded')) {
      inputData = querystring.stringify(req.body)
    } else {
      inputData = typeof req.body === 'object' ? JSON.stringify(req.body) : String(req.body)
    }
  }

  const env = {
    ...process.env,
    REQUEST_METHOD: req.method,
    REQUEST_URI: req.originalUrl,
    QUERY_STRING: req.originalUrl.split('?')[1] || '',
    SERVER_PROTOCOL: 'HTTP/1.1',
    SERVER_SOFTWARE: 'NodeJS',
    SCRIPT_NAME: req.path,
    PATH_INFO: req.path,
    CONTENT_TYPE: req.headers['content-type'] || '',
    CONTENT_LENGTH: Buffer.byteLength(inputData),
  }

  // 修正：使用 -r 参数预加载 CommonJS 脚本（即使扩展名非 .js）
  const child = spawn('node', ['-r', cgiScript, '-e', '0'], { env })

  let responseHeadersParsed = false
  let buffer = Buffer.alloc(0)

  // 写入 POST 数据
  if (inputData) {
    try {
      child.stdin.write(inputData)
    } catch (e) {
      console.error('[CGI] Write Error:', e)
    }
  }
  child.stdin.end()

  child.stdout.on('data', (chunk) => {
    if (responseHeadersParsed) {
      res.write(chunk)
      return
    }

    buffer = Buffer.concat([buffer, chunk])

    let headerEnd = -1
    if (buffer.indexOf('\r\n\r\n') !== -1) {
      headerEnd = buffer.indexOf('\r\n\r\n')
    } else if (buffer.indexOf('\n\n') !== -1) {
      headerEnd = buffer.indexOf('\n\n')
    }

    if (headerEnd !== -1) {
      const headerPart = buffer.slice(0, headerEnd).toString()
      const bodyPart = buffer.slice(headerEnd + (buffer.indexOf('\r\n\r\n') !== -1 ? 4 : 2))

      const lines = headerPart.split(/\r?\n/)
      lines.forEach((line) => {
        const parts = line.split(': ')
        const key = parts[0]
        const value = parts.slice(1).join(': ')
        if (key && value) {
          if (key.toLowerCase() === 'status') {
            res.status(parseInt(value))
          } else {
            res.setHeader(key, value)
          }
        }
      })

      responseHeadersParsed = true
      if (bodyPart.length > 0) {
        res.write(bodyPart)
      }
    }
  })

  child.stderr.on('data', (data) => {
    console.error(`[CGI Error]: ${data}`)
  })

  child.on('close', (code) => {
    if (!responseHeadersParsed) {
      console.error(`[CGI] Script exited without headers (code: ${code})`)
      if (!res.headersSent) res.status(500).send('CGI Script Error')
    }
    res.end()
  })
})

// ------------------------------------------------------------------
// 访客统计 (IP based)
// ------------------------------------------------------------------
const VISITOR_FILE = path.join(DATA_DIR, 'visitors.json')

async function ensureVisitorInit() {
  try {
    await fs.access(VISITOR_FILE)
  } catch {
    const init = {
      allTimeIps: [], // 所有历史唯一IP
      history: {}, // 每日IP记录
    }
    await fs.writeFile(VISITOR_FILE, JSON.stringify(init, null, 2))
  }
}
ensureVisitorInit()

app.post('/api/visitor/track', async (req, res) => {
  try {
    // 获取 IP
    let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''
    if (clientIp.startsWith('::ffff:')) clientIp = clientIp.substring(7)
    if (clientIp.includes(',')) clientIp = clientIp.split(',')[0].trim()

    if (!clientIp) clientIp = 'unknown'

    let stats
    try {
      stats = JSON.parse(await fs.readFile(VISITOR_FILE, 'utf-8'))
    } catch {
      stats = { allTimeIps: [], history: {} }
    }

    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    if (!stats.history) stats.history = {}
    if (!stats.allTimeIps) stats.allTimeIps = []

    // 记录今日 IP
    if (!stats.history[today]) {
      stats.history[today] = []
    }

    if (!stats.history[today].includes(clientIp)) {
      stats.history[today].push(clientIp)
    }

    // 记录历史唯一 IP
    if (!stats.allTimeIps.includes(clientIp)) {
      stats.allTimeIps.push(clientIp)
    }

    await fs.writeFile(VISITOR_FILE, JSON.stringify(stats, null, 2))

    res.json({
      success: true,
      totalVisitors: stats.allTimeIps.length,
      todayVisitors: stats.history[today].length,
      ip: clientIp,
    })
  } catch (err) {
    console.error('[Visitor Track Error]:', err)
    res.status(500).json({ error: 'Failed to track visitor' })
  }
})

// ------------------------------------------------------------------
// 音乐上传
// ------------------------------------------------------------------
app.post('/api/music/upload', upload.array('files'), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' })
    }
    res.json({ success: true, count: req.files.length })
  } catch (err) {
    console.error('Upload error:', err)
    res.status(500).json({ error: 'Upload failed' })
  }
})

// 静态文件
app.use('/music', express.static(MUSIC_DIR))

// ------------------------------------------------------------------
// 前端 dist 目录
// ------------------------------------------------------------------
const distPath = path.join(__dirname, '../dist')
app.use(express.static(distPath))
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
})
