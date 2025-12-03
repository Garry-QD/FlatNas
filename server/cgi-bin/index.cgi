#!/usr/bin/env node

// 脚本名称: index.cgi
// 　　版本: 1.0.0
// 　　作者: FNOSP/MR_XIAOBO
// 创建日期: 2025-11-19
// 最后修改: 2025-11-19
// 　　描述: 这个脚本用于演示NodeJS脚本实现CGI的过程及原理
// 使用方式: 文件重命名，从node_cgi_demo.js改成index.cgi,放置应用包/ui路径下，记得 chmod +x index.cgi 赋权
// 环境依赖: NodeJS脚本语言实现CGI程序时，应用包目录中manifest文件中必须声明依赖（install_dep_apps属性）缺少NodeJS环境脚本将无法正常解析
// 　　　　  依赖声明详见：https://developer.fnnas.com/docs/core-concepts/manifest#%E4%BE%9D%E8%B5%96%E7%AE%A1%E7%90%86
// 　许可证: MIT

// 引入内置模块（解析查询字符串）
const querystring = require('querystring')

// 从环境变量获取请求元数据
const method = process.env.REQUEST_METHOD // 请求方法（GET/POST等）
const queryStr = process.env.QUERY_STRING || '' // GET查询字符串
const contentType = process.env.CONTENT_TYPE || '' // 请求体类型
const contentLength = parseInt(process.env.CONTENT_LENGTH || 0) // 请求体长度

// 工具函数：发送响应（统一处理响应头和响应体）
function sendResponse(statusCode = 200, headers = {}, body = '') {
  // 响应状态行（如 HTTP/1.1 200 OK）
  console.log(`Status: ${statusCode} ${getStatusText(statusCode)}`)
  // 响应头（默认添加 Content-Type）
  const defaultHeaders = { 'Content-Type': 'text/html; charset=utf-8' }
  const finalHeaders = { ...defaultHeaders, ...headers }
  for (const [key, value] of Object.entries(finalHeaders)) {
    console.log(`${key}: ${value}`)
  }
  // 响应头与响应体的分隔符（空行）
  console.log('')
  // 响应体
  console.log(body)
}

// 辅助函数：根据状态码返回描述文本
function getStatusText(code) {
  const statusMap = {
    200: 'OK',
    400: 'Bad Request',
    405: 'Method Not Allowed',
  }
  return statusMap[code] || 'Unknown'
}

// 处理 GET 请求（解析查询参数）
function handleGet() {
  // 解析 query string 为对象（如 "name=foo&age=18" → { name: 'foo', age: '18' }）
  const queryData = querystring.parse(queryStr)
  // 返回 JSON 响应（演示不同 Content-Type）
  sendResponse(
    200,
    { 'Content-Type': 'application/json' },
    JSON.stringify({
      method: 'GET',
      message: 'GET 请求处理成功',
      query: queryData,
    }),
  )
}

// 处理 POST 请求（解析请求体，支持表单数据）
function handlePost() {
  let postData = ''

  // 读取标准输入（POST 请求体）
  process.stdin.on('data', (chunk) => {
    postData += chunk.toString()
    // 防止数据超出 Content-Length（避免恶意请求）
    if (postData.length > contentLength) {
      process.stdin.destroy(new Error('请求体长度超出限制'))
    }
  })

  // 读取完成后处理
  process.stdin.on('end', () => {
    let parsedData = {}
    // 根据 Content-Type 解析数据（这里处理表单类型）
    if (contentType.includes('application/x-www-form-urlencoded')) {
      parsedData = querystring.parse(postData)
    } else {
      // 其他类型（如 raw 文本）直接返回
      parsedData = { raw: postData }
    }

    // 返回 JSON 响应
    sendResponse(
      200,
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        method: 'POST',
        message: 'POST 请求处理成功',
        body: parsedData,
      }),
    )
  })

  // 读取错误处理
  process.stdin.on('error', (err) => {
    sendResponse(
      400,
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        error: '请求体读取失败',
        details: err.message,
      }),
    )
  })
}

// 主逻辑：根据请求方法分发处理
if (method === 'GET') {
  handleGet()
} else if (method === 'POST') {
  handlePost()
} else {
  // 不支持的请求方法
  sendResponse(
    405,
    { 'Content-Type': 'application/json' },
    JSON.stringify({
      error: `不支持 ${method} 方法`,
    }),
  )
}
