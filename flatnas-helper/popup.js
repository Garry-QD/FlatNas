document.addEventListener('DOMContentLoaded', () => {
  checkHandshake()

  document.getElementById('retryBtn').addEventListener('click', () => {
    document.getElementById('error-msg').style.display = 'none'
    document.getElementById('checking').style.display = 'block'
    checkHandshake()
  })

  // 绑定强制进入按钮
  bindForceBtn()
})

function bindForceBtn() {
  const forceBtn = document.getElementById('forceBtn')
  if (forceBtn) {
    // 避免重复绑定
    const newForceBtn = forceBtn.cloneNode(true)
    forceBtn.parentNode.replaceChild(newForceBtn, forceBtn)

    newForceBtn.addEventListener('click', (e) => {
      e.preventDefault()
      document.getElementById('error-msg').style.display = 'none'
      document.getElementById('checking').style.display = 'none'
      document.getElementById('app-content').style.display = 'block'
      initPopup()
    })
  }
}

async function checkHandshake() {
  const checkingEl = document.getElementById('checking')
  const appContentEl = document.getElementById('app-content')
  const errorMsgEl = document.getElementById('error-msg')

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

    if (!tab) {
      throw new Error('No active tab')
    }

    console.log('Checking tab:', tab.url)

    // 握手检查：检查当前页面是否有特定类名的元素
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const el = document.querySelector('.flatnas-handshake-signal')
        console.log('Searching for .flatnas-handshake-signal:', el)
        return !!el
      },
    })

    const isHandshakeValid = results && results[0] && results[0].result
    console.log('Handshake result:', isHandshakeValid)

    checkingEl.style.display = 'none'

    if (isHandshakeValid) {
      appContentEl.style.display = 'block'
      initPopup()
    } else {
      errorMsgEl.style.display = 'block'
      // 确保在显示错误页时，强制按钮也是绑定好的
      bindForceBtn()
    }
  } catch (err) {
    console.error('Handshake error:', err)
    checkingEl.style.display = 'none'

    // 如果是 DOMContentLoaded 时发生的错误，可能元素还没加载出来，保留重试按钮
    // 这里的 errorMsgEl 内容如果是默认的，就不覆盖了，否则显示具体错误
    const defaultErrorHtml = `
     <p>未检测到 FlatNas 配置页面。</p>
     <p class="note" style="color: #666; margin: 10px 0;">
       请确保：<br>
       1. 已打开 FlatNas 网页<br>
       2. 已点击右上角设置(⚙️)按钮<br>
       3. 已添加或展开"万能窗口"配置卡片
     </p>
     <button id="retryBtn" style="background-color: #2196F3; margin-top: 10px;">重试</button>
     <div style="margin-top: 15px; text-align: center;">
       <a href="#" id="forceBtn" style="color: #999; font-size: 12px; text-decoration: underline;">手动填写/修改地址</a>
     </div>
    `

    // 只有当是严重错误（非握手失败）时才覆盖提示，但保留重试逻辑
    // 为了简单，我们只在 console 打印错误，界面上还是显示通用的错误提示，除非是权限错误
    if (err.message && err.message.includes('Cannot access')) {
      errorMsgEl.innerHTML = `<p style='color:red'>无法访问当前页面。</p><p class='note'>请确保在 http/https 页面使用插件。</p>`
    } else {
      // 重新绑定重试按钮（如果 innerHTML 被重置了）
      if (!document.getElementById('retryBtn')) {
        errorMsgEl.innerHTML = defaultErrorHtml
        document.getElementById('retryBtn').addEventListener('click', () => {
          errorMsgEl.style.display = 'none'
          checkingEl.style.display = 'block'
          checkHandshake()
        })
        bindForceBtn()
      }
    }
    errorMsgEl.style.display = 'block'
  }
}

function initPopup() {
  chrome.storage.sync.get(['nasDomains'], (result) => {
    if (result.nasDomains) {
      document.getElementById('domainInput').value = result.nasDomains
    }
  })

  // 避免重复绑定
  const saveBtn = document.getElementById('saveBtn')
  const newSaveBtn = saveBtn.cloneNode(true)
  saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn)

  newSaveBtn.addEventListener('click', () => {
    const input = document.getElementById('domainInput').value
    const btn = document.getElementById('saveBtn')

    // 1. UI 交互反馈
    const originalText = btn.textContent
    btn.textContent = '保存中...'
    btn.disabled = true

    const domains = input
      .split(',')
      .map((d) => d.trim())
      .filter((d) => d.length > 0)
      .map((d) => {
        // 尝试提取 hostname (自动去除 http/https 和 端口号)
        try {
          const urlStr = d.startsWith('http') ? d : 'http://' + d
          return new URL(urlStr).hostname
        } catch {
          // 降级处理
          return d
            .replace(/^https?:\/\//, '')
            .replace(/\/$/, '')
            .replace(/:\d+$/, '')
        }
      })

    chrome.storage.sync.set({ nasDomains: input }, () => {
      // 存储完成后更新规则
      updateRules(domains, () => {
        // 2. 恢复按钮状态并提示
        btn.textContent = '保存成功！'
        btn.style.backgroundColor = '#4CAF50' // 保持绿色

        showStatus('设置已生效，请刷新 NAS 页面。')

        // 2秒后恢复按钮文字
        setTimeout(() => {
          btn.textContent = originalText
          btn.disabled = false
        }, 2000)
      })
    })
  })
}

function updateRules(domains, callback) {
  if (domains.length === 0) {
    chrome.declarativeNetRequest.updateDynamicRules(
      {
        removeRuleIds: [1],
        addRules: [],
      },
      () => {
        if (callback) callback()
      },
    )
    return
  }

  const newRule = {
    id: 1,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'content-security-policy', operation: 'remove' },
        { header: 'x-frame-options', operation: 'remove' },
      ],
    },
    condition: {
      resourceTypes: ['sub_frame'],
      initiatorDomains: domains,
    },
  }

  chrome.declarativeNetRequest.updateDynamicRules(
    {
      removeRuleIds: [1],
      addRules: [newRule],
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError)
        showStatus('保存失败: ' + chrome.runtime.lastError.message)
      } else {
        if (callback) callback()
      }
    },
  )
}

function showStatus(msg) {
  const status = document.getElementById('status')
  status.textContent = msg
  status.style.display = 'block'
  setTimeout(() => {
    status.style.display = 'none'
  }, 2000)
}
