
export const internalWhitelist = [
  'localhost',
  '127.0.0.1',
  '192.168.',
  '10.',
  '172.16.',
  // Note: 172.16.0.0/12 is covered by regex in function
];

export const isInternalDomain = (urlStr: string) => {
  try {
    // Handle URLs without protocol for parsing
    const u = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`)
    const h = u.hostname
    
    // Whitelist check
    if (h === 'localhost') return true
    if (h.startsWith('127.')) return true
    if (h.startsWith('192.168.')) return true
    if (h.startsWith('10.')) return true
    // 172.16.0.0 - 172.31.255.255
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true
    
    return false
  } catch {
    return false
  }
}

export const processSecurityUrl = (targetUrl: string): string => {
    // Force HTTPS and Absolute URL
    if (targetUrl.startsWith('http://')) {
       targetUrl = targetUrl.replace('http://', 'https://')
    } else if (!targetUrl.startsWith('https://')) {
       targetUrl = `https://${targetUrl}`
    }

    // Encode URL (Requirement: encodeURIComponent logic, applied via encodeURI for full URL safety)
    return encodeURI(targetUrl)
}
