export interface NavItem {
  id: string;
  title: string;
  url: string;
  lanUrl?: string;
  icon: string;
  // Horizontal mode custom text lines
  description1?: string;
  description2?: string;
  description3?: string;
  color?: string;
  titleColor?: string;
  isPublic: boolean;
  backgroundImage?: string;
  backgroundBlur?: number;
  backgroundMask?: number;
}

export interface NavGroup {
  id: string;
  title: string;
  items: NavItem[];
  isPublic?: boolean;
  titleColor?: string;
  preset?: boolean;
  cardLayout?: "vertical" | "horizontal" | string;
  iconShape?:
    | "circle"
    | "rounded"
    | "leaf"
    | "square"
    | "diamond"
    | "pentagon"
    | "hexagon"
    | "octagon"
    | string;
  cardBgColor?: string;
  cardTitleColor?: string;
  showCardBackground?: boolean;
  backgroundImage?: string;
  backgroundBlur?: number;
  backgroundMask?: number;
  autoHideTitle?: boolean;
  // Layout config overrides
  gridGap?: number;
  cardSize?: number;
  gap?: number;
  minWidth?: number;
  height?: number;
  iconSize?: number;
}

export interface SearchEngine {
  id: string;
  key: string;
  label: string;
  urlTemplate: string;
}

export interface AppConfig {
  background: string;
  mobileBackground?: string;
  enableMobileWallpaper?: boolean;
  fixedWallpaper?: boolean; // Deprecated in favor of specific rotation flags
  pcRotation?: boolean;
  pcRotationInterval?: number;
  pcRotationMode?: "random" | "sequential";
  mobileRotation?: boolean;
  mobileRotationInterval?: number;
  mobileRotationMode?: "random" | "sequential";
  deviceMode?: "auto" | "desktop" | "tablet" | "mobile";
  backgroundBlur?: number;
  backgroundMask?: number;
  mobileBackgroundBlur?: number;
  mobileBackgroundMask?: number;
  customTitle: string;
  titleAlign: "left" | "center" | "right" | string;
  titleSize: number;
  titleColor: string;
  cardLayout: "vertical" | "horizontal" | string;
  cardSize: number;
  gridGap: number;
  cardBgColor: string;
  cardTitleColor: string;
  cardBorderColor: string;
  showCardBackground: boolean;
  iconShape:
    | "circle"
    | "rounded"
    | "leaf"
    | "square"
    | "diamond"
    | "pentagon"
    | "hexagon"
    | "octagon"
    | string;
  searchEngines: SearchEngine[];
  defaultSearchEngine: string;
  rememberLastEngine: boolean;
  groupTitleColor: string;
  groupGap?: number;
  autoPlayMusic?: boolean;
  iconSize?: number;
  showFooterStats?: boolean;
  footerHtml?: string;
  footerHeight?: number;
  footerWidth?: number;
  footerMarginBottom?: number;
  footerFontSize?: number;
  weatherApiUrl?: string; // Custom API URL
  weatherSource?: "wttr" | "amap"; // Weather source
  amapKey?: string; // AMap API Key
  // Wallpaper API management
  wallpaperApiPcList?: string;
  wallpaperApiPcUpload?: string;
  wallpaperApiPcDeleteBase?: string;
  wallpaperPcImageBase?: string;
  wallpaperApiMobileList?: string;
  wallpaperApiMobileUpload?: string;
  wallpaperApiMobileDeleteBase?: string;
  wallpaperMobileImageBase?: string;
}

export interface WidgetConfig {
  id: string;
  type: string;
  enable: boolean;
  colSpan?: number;
  rowSpan?: number;
  // Grid Layout props
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  isPublic: boolean;
  hideOnMobile?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  layouts?: {
    desktop?: { x: number; y: number; w: number; h: number };
    tablet?: { x: number; y: number; w: number; h: number };
    mobile?: { x: number; y: number; w: number; h: number };
  };
}

export interface SimpleIcon {
  title: string;
  slug: string;
  hex: string;
  source: string;
  svg: string;
  path: string;
  guidelines?: string;
  license?: {
    type: string;
    url: string;
  };
}

export interface RssFeed {
  id: string;
  url: string;
  title: string;
  category?: string;
  tags?: string[];
  enable: boolean;
  isPublic: boolean;
}

export interface RssCategory {
  id: string;
  name: string;
  feeds: RssFeed[];
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
