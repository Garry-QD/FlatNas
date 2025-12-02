export interface NavItem {
  id: string;
  title: string;
  url: string;
  lanUrl?: string;
  icon?: string;
  color?: string;
  isPublic?: boolean;
}

// ✨✨✨ 新增：分组结构 ✨✨✨
export interface NavGroup {
  id: string;
  title: string;
  items: NavItem[];
  preset?: boolean;
  titleColor?: string; // Custom color for the group title
  isLocked?: boolean; // Group locking status
  // Per-group settings
  cardLayout?: 'vertical' | 'horizontal';
  cardSize?: number;
  iconSize?: number;
  gridGap?: number;
  cardBgColor?: string;
  cardTitleColor?: string;
  showCardBackground?: boolean;
  iconShape?: 'rounded' | 'circle' | 'square' | 'leaf' | 'diamond' | 'pentagon' | 'hexagon' | 'octagon';
}

export interface AppConfig {
  background: string;
  customTitle: string;
  titleAlign: 'left' | 'center' | 'right';
  titleSize: number;
  titleColor: string;
  cardLayout: 'vertical' | 'horizontal';
  cardSize: number;
  iconSize?: number;
  gridGap: number;
  cardBgColor: string;
  cardTitleColor?: string;
  cardBorderColor?: string;
  showCardBackground?: boolean;
  iconShape: 'rounded' | 'circle' | 'square' | 'leaf' | 'diamond' | 'pentagon' | 'hexagon' | 'octagon';
  searchEngines?: Array<{ id: string; key: string; label: string; urlTemplate: string }>;
  defaultSearchEngine?: string;
  rememberLastEngine?: boolean;
  groupTitleColor?: string;
}

export interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  icon?: string;
}

export interface BookmarkCategory {
  id: string;
  title: string;
  collapsed?: boolean;
  children: BookmarkItem[];
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export interface RssFeed {
  id: string;
  title: string;
  url: string;
  category?: string;
  tags?: string[];
  enable: boolean;
  isPublic: boolean;
}

export interface RssCategory {
  id: string;
  name: string;
}

// ... 前面的 NavItem 等保持不变 ...

export interface WidgetConfig {
  id: string;
  // ✨ 在这里加上 'hot'
  type: 'clock' | 'weather' | 'calendar' | 'memo' | 'search' | 'quote' | 'bookmarks' | 'todo' | 'calculator' | 'ip' | 'iframe' | 'player' | 'hot' | 'clockweather' | 'rss';
  enable: boolean;
  data?: any;
  colSpan?: number;
  rowSpan?: number;
  isPublic?: boolean;
}
