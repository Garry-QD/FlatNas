export interface NavItem {
  id: string
  title: string
  url: string
  lanUrl?: string
  icon: string
  color?: string
  isPublic: boolean
  backgroundImage?: string
  backgroundBlur?: number
  backgroundMask?: number
}

export interface NavGroup {
  id: string
  title: string
  items: NavItem[]
  titleColor?: string
  preset?: boolean
  cardLayout?: 'vertical' | 'horizontal' | string
  iconShape?:
    | 'circle'
    | 'rounded'
    | 'leaf'
    | 'square'
    | 'diamond'
    | 'pentagon'
    | 'hexagon'
    | 'octagon'
    | string
  cardBgColor?: string
  cardTitleColor?: string
  showCardBackground?: boolean
  backgroundImage?: string
  backgroundBlur?: number
  backgroundMask?: number
  // Layout config overrides
  gridGap?: number
  cardSize?: number
  gap?: number
  minWidth?: number
  height?: number
  iconSize?: number
}

export interface SearchEngine {
  id: string
  key: string
  label: string
  urlTemplate: string
}

export interface AppConfig {
  background: string
  backgroundBlur?: number
  backgroundMask?: number
  customTitle: string
  titleAlign: 'left' | 'center' | 'right' | string
  titleSize: number
  titleColor: string
  cardLayout: 'vertical' | 'horizontal' | string
  cardSize: number
  gridGap: number
  cardBgColor: string
  cardTitleColor: string
  cardBorderColor: string
  showCardBackground: boolean
  iconShape:
    | 'circle'
    | 'rounded'
    | 'leaf'
    | 'square'
    | 'diamond'
    | 'pentagon'
    | 'hexagon'
    | 'octagon'
    | string
  searchEngines: SearchEngine[]
  defaultSearchEngine: string
  rememberLastEngine: boolean
  groupTitleColor: string
  autoPlayMusic?: boolean
  iconSize?: number
  showFooterStats?: boolean
  footerHtml?: string
  footerHeight?: number
  footerWidth?: number
  footerMarginBottom?: number
  footerFontSize?: number
}

export interface WidgetConfig {
  id: string
  type: string
  enable: boolean
  colSpan?: number
  rowSpan?: number
  isPublic: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any
}

export interface SimpleIcon {
  title: string
  slug: string
  hex: string
  source: string
  svg: string
  path: string
  guidelines?: string
  license?: {
    type: string
    url: string
  }
}

export interface RssFeed {
  id: string
  url: string
  title: string
  category?: string
  tags?: string[]
  enable: boolean
  isPublic: boolean
}

export interface RssCategory {
  id: string
  name: string
  feeds: RssFeed[]
}

export interface BookmarkItem {
  id: string
  title: string
  url: string
  icon?: string
}

export interface TodoItem {
  id: string
  text: string
  done: boolean
}
