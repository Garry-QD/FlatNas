package models

type User struct {
	Username      string    `json:"username"`
	Password      string    `json:"password"` // Hashed
	Groups        []Group   `json:"groups"`
	Widgets       []Widget  `json:"widgets"`
	AppConfig     AppConfig `json:"appConfig"`
	RssFeeds      []any     `json:"rssFeeds"`      // Simplified for now
	RssCategories []any     `json:"rssCategories"` // Simplified for now
}

type Group struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Items []Item `json:"items"`
}

type Item struct {
	ID              string  `json:"id"`
	Title           string  `json:"title"`
	Url             string  `json:"url"`
	LanUrl          string  `json:"lanUrl,omitempty"`
	Icon            string  `json:"icon"`
	Color           string  `json:"color,omitempty"`
	IsPublic        bool    `json:"isPublic"`
	ContainerID     string  `json:"containerId,omitempty"`
	ContainerName   string  `json:"containerName,omitempty"`
	BackgroundImage string  `json:"backgroundImage,omitempty"`
	BackgroundBlur  int     `json:"backgroundBlur,omitempty"`
	BackgroundMask  float64 `json:"backgroundMask,omitempty"`
	Description1    string  `json:"description1,omitempty"`
	Description2    string  `json:"description2,omitempty"`
	Description3    string  `json:"description3,omitempty"`
	TitleColor      string  `json:"titleColor,omitempty"`
	IconSize        int     `json:"iconSize,omitempty"`
	BackupUrls      []any   `json:"backupUrls,omitempty"`
	BackupLanUrls   []any   `json:"backupLanUrls,omitempty"`
	AlternateUrls   []any   `json:"alternateUrls,omitempty"`
}

type Widget struct {
	ID       string                  `json:"id"`
	Type     string                  `json:"type"`
	Enable   bool                    `json:"enable"`
	IsPublic bool                    `json:"isPublic"`
	Data     any                     `json:"data"` // Flexible
	Layouts  map[string]WidgetLayout `json:"layouts,omitempty"`
	X        float64                 `json:"x,omitempty"`
	Y        float64                 `json:"y,omitempty"`
	W        float64                 `json:"w,omitempty"`
	H        float64                 `json:"h,omitempty"`
	ColSpan  float64                 `json:"colSpan,omitempty"`
	RowSpan  float64                 `json:"rowSpan,omitempty"`
}

type WidgetLayout struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

type AppConfig struct {
	Background            string          `json:"background,omitempty"`
	MobileBackground      string          `json:"mobileBackground,omitempty"`
	WallpaperConfig       WallpaperConfig `json:"wallpaperConfig,omitempty"`
	MobileWallpaperConfig WallpaperConfig `json:"mobileWallpaperConfig,omitempty"`
	Theme                 string          `json:"theme,omitempty"`
	CustomCss             string          `json:"customCss,omitempty"`
	CustomJs              string          `json:"customJs,omitempty"`
	InternalDomains       string          `json:"internalDomains,omitempty"`
	NetworkRules          string          `json:"networkRules,omitempty"`
	LanProbeTarget        string          `json:"lanProbeTarget,omitempty"`
	AllowGuestLanAccess   bool            `json:"allowGuestLanAccess,omitempty"`
	LatencyThresholdMs    int             `json:"latencyThresholdMs,omitempty"`
	WhitelistLatencyMode  bool            `json:"whitelistLatencyMode,omitempty"`
}

type WallpaperConfig struct {
	Enabled     bool   `json:"enabled"`
	Type        string `json:"type"` // "api", "bing", "upload"
	Url         string `json:"url,omitempty"`
	LastUpdated int64  `json:"lastUpdated,omitempty"`
}

type SystemConfig struct {
	AuthMode     string `json:"authMode"` // "single" or "multi"
	EnableDocker bool   `json:"enableDocker"`
	DockerHost   string `json:"dockerHost,omitempty"`
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type VisitorStats struct {
	TotalVisitors int64  `json:"totalVisitors"`
	TodayVisitors int64  `json:"todayVisitors"`
	LastVisitDate string `json:"lastVisitDate"` // YYYY-MM-DD
}

type TransferItem struct {
	ID        string        `json:"id"`
	Type      string        `json:"type"` // "text" or "file"
	Content   string        `json:"content,omitempty"`
	File      *TransferFile `json:"file,omitempty"`
	Timestamp int64         `json:"timestamp"`
	Sender    string        `json:"sender"`
}

type TransferFile struct {
	Name   string            `json:"name"`
	Size   int64             `json:"size"`
	Type   string            `json:"type"`
	Url    string            `json:"url"`
	Thumbs map[string]string `json:"thumbs,omitempty"`
}

type TransferData struct {
	Items []TransferItem `json:"items"`
}
