
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SUNPANEL_CONFIG_PATH = 'c:\\Users\\80425\\Desktop\\SunPanel-Data202512070151.sun-panel.json'
const FLATNAS_API_URL = 'http://localhost:3000/api/data'

async function importSunPanelConfig() {
  try {
    // 1. 读取 SunPanel 配置文件
    const sunPanelConfigContent = await fs.readFile(SUNPANEL_CONFIG_PATH, 'utf-8')
    const sunPanelConfig = JSON.parse(sunPanelConfigContent)

    if (!sunPanelConfig.icons || !Array.isArray(sunPanelConfig.icons)) {
      console.error('SunPanel config does not contain a valid "icons" array.')
      return
    }

    // 2. 解析并转换数据
    const flatNasGroups = sunPanelConfig.icons.map((group, groupIndex) => {
      const navItems = (group.children || []).map((item, itemIndex) => ({
        id: `item-${groupIndex}-${itemIndex}-${Date.now()}`,
        title: item.title || '未知标题',
        url: item.url || '',
        lanUrl: item.lanUrl || '',
        icon: item.icon?.src || '',
        isPublic: true, // 默认设置为公开
      }))

      return {
        id: `group-${groupIndex}-${Date.now()}`,
        title: group.title || '未知分组',
        items: navItems,
        preset: false, // 导入的组不是预设的
      }
    })

    // 获取当前的 FlatNas 配置，以便合并
    const currentFlatNasConfigRes = await fetch(FLATNAS_API_URL)
    const currentFlatNasConfig = await currentFlatNasConfigRes.json()

    // 合并新的分组到现有配置中
    const updatedFlatNasConfig = {
      ...currentFlatNasConfig,
      groups: [...(currentFlatNasConfig.groups || []), ...flatNasGroups],
    }

    // 3. 调用导入 API
    const response = await fetch(FLATNAS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatedFlatNasConfig),
    })

    if (response.ok) {
      console.log('SunPanel 配置已成功导入到 FlatNas。')
    } else {
      const errorText = await response.text()
      console.error(`导入失败: ${response.status} ${response.statusText} - ${errorText}`)
    }
  } catch (error) {
    console.error('导入过程中发生错误:', error)
  }
}

importSunPanelConfig()
