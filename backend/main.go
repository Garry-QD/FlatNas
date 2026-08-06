package main

import (
	"flatnasgo-backend/config"
	"flatnasgo-backend/handlers"
	"flatnasgo-backend/middleware"
	"flatnasgo-backend/ws"
	"fmt"
	"log"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
	socketio "github.com/googollee/go-socket.io"
	"github.com/googollee/go-socket.io/engineio"
	"github.com/googollee/go-socket.io/engineio/transport"
	"github.com/googollee/go-socket.io/engineio/transport/polling"
	"github.com/googollee/go-socket.io/engineio/transport/websocket"
)

func init() {
	mime.AddExtensionType(".gif", "image/gif")
	mime.AddExtensionType(".webp", "image/webp")
	mime.AddExtensionType(".svg", "image/svg+xml")
	mime.AddExtensionType(".ico", "image/x-icon")
	mime.AddExtensionType(".jpeg", "image/jpeg")
	mime.AddExtensionType(".mp3", "audio/mpeg")
	mime.AddExtensionType(".flac", "audio/flac")
	mime.AddExtensionType(".wav", "audio/wav")
	mime.AddExtensionType(".m4a", "audio/mp4")
	mime.AddExtensionType(".ogg", "audio/ogg")
}

func staticCacheControlForPath(reqPath string) string {
	switch {
	case strings.HasPrefix(reqPath, "/assets/"):
		return "public, max-age=31536000, immutable"
	case strings.HasPrefix(reqPath, "/icons/"),
		strings.HasPrefix(reqPath, "/backgrounds/"),
		strings.HasPrefix(reqPath, "/mobile_backgrounds/"),
		strings.HasPrefix(reqPath, "/icon-cache/"),
		strings.HasPrefix(reqPath, "/public/"),
		reqPath == "/favicon.ico":
		return "public, max-age=604800, stale-while-revalidate=86400"
	case reqPath != "/" && reqPath != "/index.html" && path.Ext(reqPath) != "":
		return "public, max-age=604800, stale-while-revalidate=86400"
	default:
		return ""
	}
}

func normalizeBasePath(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" || value == "/" {
		return ""
	}
	if !strings.HasPrefix(value, "/") {
		value = "/" + value
	}
	value = strings.TrimRight(value, "/")
	if value == "/" {
		return ""
	}
	return value
}

func mountPath(basePath, reqPath string) string {
	if basePath == "" {
		return reqPath
	}
	if reqPath == "/" {
		return basePath
	}
	return basePath + reqPath
}

func hasMountedPrefix(reqPath, prefix string) bool {
	return reqPath == prefix || strings.HasPrefix(reqPath, prefix+"/")
}

func trimBasePath(basePath, reqPath string) string {
	if basePath == "" {
		return reqPath
	}
	if reqPath == basePath {
		return "/"
	}
	if strings.HasPrefix(reqPath, basePath+"/") {
		return strings.TrimPrefix(reqPath, basePath)
	}
	return reqPath
}


func main() {
	fmt.Println("Backend process started")
	gin.SetMode(gin.ReleaseMode)
	config.Init()
	handlers.InitWidgetCache()
	handlers.InitGeocodingCache()
	handlers.InitDocker()
	handlers.StartIPFetcher()
	handlers.StartDataWarmup()
	handlers.StartThumbSync()
	handlers.NewWeatherPoller().Start()

	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Next()
	})
	if gin.Mode() != gin.ReleaseMode {
		r.Use(gin.Logger())
	}
	r.Use(middleware.RecoveryMiddleware())
	r.Use(middleware.GzipDecompressMiddleware())

	basePath := normalizeBasePath(os.Getenv("BASE_PATH"))
	wsPath := mountPath(basePath, "/ws")
	socketIOPath := mountPath(basePath, "/socket.io")
	apiPath := mountPath(basePath, "/api")
	proxyPath := mountPath(basePath, "/proxy")

	// Native WebSocket upgrade must happen before middleware that may wrap
	// the response writer and break Hijack semantics (for example gzip).
	wsManager := ws.NewManager()
	r.GET(wsPath, ws.WSHandler(wsManager))
	ws.SetBroadcaster(&ws.WSBroadcaster{Manager: wsManager})

	// Gzip 压缩中间件 - 大幅减少网络传输量，适应内网穿透/慢速网络环境
	// 排除 /ws 路径，避免破坏 WebSocket 升级
	r.Use(gzip.Gzip(gzip.DefaultCompression, gzip.WithExcludedPaths([]string{wsPath})))

	// 设置请求体大小限制（增加到 50MB，适应大配置文件）
	r.MaxMultipartMemory = 50 << 20 // 50 MB

	allowedOrigins := map[string]struct{}{}
	rawAllowed := strings.TrimSpace(os.Getenv("CORS_ALLOW_ORIGINS"))
	if rawAllowed != "" {
		for _, origin := range strings.Split(rawAllowed, ",") {
			o := strings.TrimSpace(origin)
			if o != "" {
				allowedOrigins[o] = struct{}{}
			}
		}
	}
	allowAllOrigins := len(allowedOrigins) == 0
	allowOriginFunc := func(origin string) bool {
		if allowAllOrigins {
			return true
		}
		_, ok := allowedOrigins[origin]
		return ok
	}

	// CORS
	r.Use(cors.New(cors.Config{
		AllowOriginFunc: func(origin string) bool {
			return allowOriginFunc(origin)
		},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "Accept", "X-Requested-With"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	// Socket.IO
	server := socketio.NewServer(&engineio.Options{
		Transports: []transport.Transport{
			&polling.Transport{
				CheckOrigin: func(r *http.Request) bool {
					return allowOriginFunc(r.Header.Get("Origin"))
				},
			},
			&websocket.Transport{
				CheckOrigin: func(r *http.Request) bool {
					return allowOriginFunc(r.Header.Get("Origin"))
				},
			},
		},
	})
	server.OnConnect("/", func(s socketio.Conn) error {
		s.SetContext("")
		u := s.URL()
		token := strings.TrimSpace(u.Query().Get("token"))
		if token == "" {
			token = strings.TrimSpace(s.RemoteHeader().Get("Authorization"))
		}
		if token != "" {
			handlers.AuthorizeSocketConn(s, token)
		}
		return nil
	})
	server.OnDisconnect("/", func(s socketio.Conn, reason string) {
	})
	server.OnEvent("/", "join", func(s socketio.Conn, room string) {
		room = strings.TrimSpace(room)
		if room == "" {
			return
		}
		if strings.HasPrefix(room, "user:") {
			username, _ := s.Context().(string)
			if handlers.SocketUserRoom(username) != room {
				return
			}
		}
		s.Join(room)
	})
	handlers.BindHotHandlers(server)
	handlers.BindWeatherHandlers(server)
	handlers.BindRssHandlers(server) // Added RSS handlers
	handlers.BindMemoHandlers(server)
	handlers.BindTodoHandlers(server)
	handlers.BindNetworkHandlers(server)
	handlers.SetSocketServer(server)
	go server.Serve()
	defer server.Close()

	r.GET(socketIOPath+"/*any", gin.WrapH(server))
	r.POST(socketIOPath+"/*any", gin.WrapH(server))

	// WebSocket (原生) - 与 Socket.IO 并行运行，逐步迁移
	// Static Files
	r.Use(func(c *gin.Context) {
		reqPath := trimBasePath(basePath, c.Request.URL.Path)
		if strings.HasPrefix(reqPath, "/api") || strings.HasPrefix(reqPath, "/socket.io") || strings.HasPrefix(reqPath, "/ws") || reqPath == "/proxy" {
			c.Next()
			return
		}
		if cc := staticCacheControlForPath(reqPath); cc != "" {
			c.Header("Cache-Control", cc)
		}
		c.Next()
	})
	r.Static(mountPath(basePath, "/assets"), filepath.Join(config.PublicDir, "assets"))
	r.Static(mountPath(basePath, "/icons"), filepath.Join(config.PublicDir, "icons"))
	// index.html 禁止强缓存，避免部署新版本后浏览器仍用旧页面引用已不存在的 chunk（如 LoginModal-xxx.js）导致白屏/加载失败
	indexPath := filepath.Join(config.PublicDir, "index.html")
	r.GET(mountPath(basePath, "/"), func(c *gin.Context) {
		c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		c.File(indexPath)
	})
	r.GET(mountPath(basePath, "/index.html"), func(c *gin.Context) {
		c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		c.File(indexPath)
	})
	r.StaticFile(mountPath(basePath, "/favicon.ico"), filepath.Join(config.PublicDir, "favicon.ico"))
	r.Static(mountPath(basePath, "/music"), config.MusicDir)
	r.Static(mountPath(basePath, "/backgrounds"), config.BackgroundsDir)
	r.Static(mountPath(basePath, "/mobile_backgrounds"), config.MobileBackgroundsDir)
	r.Static(mountPath(basePath, "/icon-cache"), config.IconCacheDir)
	r.Static(mountPath(basePath, "/public"), config.PublicDir)
	r.Any(proxyPath, handlers.ProxyRequest)

	// Middleware to serve static files from config.PublicDir if they exist
	r.Use(func(c *gin.Context) {
		reqPath := trimBasePath(basePath, c.Request.URL.Path)
		if strings.HasPrefix(reqPath, "/api") || strings.HasPrefix(reqPath, "/socket.io") || strings.HasPrefix(reqPath, "/ws") {
			c.Next()
			return
		}

		// Check if file exists in PublicDir
		filePath := filepath.Join(config.PublicDir, reqPath)
		info, err := os.Stat(filePath)
		if err == nil && !info.IsDir() {
			c.File(filePath)
			c.Abort()
			return
		}

		c.Next()
	})

	// NoRoute handler for SPA（与上面 index 一致：不缓存，避免引用旧 chunk）
	r.NoRoute(func(c *gin.Context) {
		reqPath := trimBasePath(basePath, c.Request.URL.Path)
		if basePath != "" && !hasMountedPrefix(c.Request.URL.Path, basePath) {
			c.Status(http.StatusNotFound)
			return
		}
		// 安全加固：对源码/调试类资源（.map / .ts / .tsx / .vue / .scss 等）
		// 不再走 SPA fallback，避免自动化扫描器误报“源码泄露”。
		// 这些扩展名不属于 SPA 路由的合法 URL，理应直接返回 404。
		lowerReq := strings.ToLower(reqPath)
		debugSuffixes := []string{".map", ".ts", ".tsx", ".vue", ".scss", ".sass", ".less"}
		for _, suf := range debugSuffixes {
			if strings.HasSuffix(lowerReq, suf) {
				c.Status(http.StatusNotFound)
				return
			}
		}
		if !strings.HasPrefix(reqPath, "/api") && !strings.HasPrefix(reqPath, "/socket.io") && !strings.HasPrefix(reqPath, "/ws") {
			c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
			c.File(filepath.Join(config.PublicDir, "index.html"))
			return
		}
		c.Status(http.StatusNotFound)
	})

	// API Routes
	api := r.Group(apiPath)
	{
		api.POST("/login", handlers.Login)
		api.POST("/register", handlers.Register)
		api.GET("/data", middleware.OptionalAuthMiddleware(), handlers.GetData)
		api.GET("/version", middleware.OptionalAuthMiddleware(), handlers.GetVersion)
		api.GET("/system-config", handlers.GetSystemConfig)
		api.GET("/ip", handlers.GetIP) // Added GetIP
		api.GET("/hot", handlers.GetHot)
		api.GET("/rss", handlers.GetRss)
		api.GET("/rss/meta", handlers.GetRssMeta)
		api.GET("/weather", handlers.GetWeather)                                                   // Added Weather
		api.GET("/custom-scripts", middleware.OptionalAuthMiddleware(), handlers.GetCustomScripts) // Added Custom Scripts
		api.GET("/docker-status", handlers.GetDockerStatus)                                        // Added Docker Status
		api.GET("/docker/debug", handlers.GetDockerDebug)
		api.GET("/config/proxy-status", handlers.GetProxyStatus)
		api.GET("/widgets/:id", handlers.GetWidget) // Added Widget Data
		api.GET("/memo/:id", middleware.AuthMiddleware(), handlers.GetMemo)

		// Icon Routes
		api.GET("/ali-icons", handlers.GetAliIcons)
		api.GET("/get-icon-base64", handlers.GetIconBase64)
		api.POST("/icon-cache", handlers.CacheIcon)

		// Amap Proxy Routes
		api.GET("/amap/weather", handlers.GetAmapWeather)
		api.GET("/amap/ip", handlers.ProxyAmapIP)

		api.GET("/ping", middleware.OptionalAuthMiddleware(), middleware.PingRateLimit(), handlers.Ping) // Hardened: input validation + rate limit
		api.GET("/rtt", handlers.RTT)                                                                    // Added RTT for frontend latency check
		api.POST("/visitor/track", handlers.TrackVisitor)                                                // Public endpoint
		api.GET("/transfer/file/:filename", middleware.OptionalAuthMiddleware(), handlers.ServeFile)
		api.GET("/transfer/thumb/:filename/:size", middleware.OptionalAuthMiddleware(), handlers.ServeThumb)
		api.GET("/music-list", handlers.GetMusicList) // Added Music List
		api.GET("/backgrounds", handlers.ListBackgrounds)
		api.GET("/mobile_backgrounds", handlers.ListMobileBackgrounds)

		// Protected Routes
		authorized := api.Group("/")
		authorized.Use(middleware.AuthMiddleware())
		{
			// User Management
			authorized.GET("/admin/users", handlers.GetUsers)
			authorized.POST("/admin/users", handlers.AddUser)
			authorized.DELETE("/admin/users/:usr", handlers.DeleteUser)
			authorized.POST("/admin/license", handlers.UploadLicense)

			authorized.POST("/save", handlers.SaveData) // Added SaveData
			authorized.PUT("/memo/:id", handlers.SaveMemo)
			authorized.PUT("/widgets/:id", handlers.SaveSingleWidget)      // Phase 3: Fine-grained widget save
			authorized.POST("/widgets/batch", handlers.GetWidgetsBatch)    // Delta Push: batch widget query
			authorized.POST("/system-config", handlers.UpdateSystemConfig) // Added SystemConfig Update
			authorized.POST("/data/import", handlers.ImportData)           // Added ImportData
			authorized.POST("/default/save", handlers.SaveDefault)
			authorized.POST("/reset", handlers.ResetData)
			authorized.GET("/system/stats", handlers.GetSystemStats)
			authorized.GET("/docker/containers", handlers.ListContainers)
			authorized.GET("/docker/info", handlers.GetDockerInfo)
			authorized.GET("/docker/export-logs", handlers.ExportDockerLogs)
			authorized.GET("/docker/container/:id/inspect-lite", handlers.ContainerInspectLite)
			authorized.POST("/docker/check-updates", handlers.TriggerUpdateCheck)
			authorized.POST("/docker/container/:id/:action", handlers.ContainerAction)
			authorized.POST("/custom-scripts", handlers.SaveCustomScripts)

			// Wallpaper
			authorized.GET("/wallpaper/proxy", handlers.ProxyWallpaper)
			authorized.POST("/wallpaper/resolve", handlers.ResolveWallpaper)
			authorized.POST("/wallpaper/fetch", handlers.FetchWallpaper)

			// Backgrounds Management
			authorized.DELETE("/backgrounds/:name", handlers.DeleteBackground)
			authorized.DELETE("/mobile_backgrounds/:name", handlers.DeleteMobileBackground)
			authorized.POST("/backgrounds/upload", handlers.UploadBackground)
			authorized.POST("/mobile_backgrounds/upload", handlers.UploadMobileBackground)
			authorized.POST("/music/upload", handlers.UploadMusic) // Added Music Upload
			authorized.DELETE("/music", handlers.DeleteMusic)      // Added Music Delete

			// Transfer
			authorized.GET("/transfer/items", handlers.GetTransferItems)
			authorized.POST("/transfer/text", handlers.SendText)
			authorized.POST("/transfer/upload/init", handlers.UploadInit)
			authorized.POST("/transfer/upload/chunk", handlers.UploadChunk)
			authorized.POST("/transfer/upload/complete", handlers.UploadComplete)
			authorized.GET("/transfer/upload/status", handlers.UploadStatus)
			authorized.POST("/transfer/upload/cancel", handlers.UploadCancel)
			authorized.POST("/transfer/download-token", handlers.DownloadToken)
			authorized.DELETE("/transfer/items/:id", handlers.DeleteItem)
			authorized.POST("/transfer/generate-thumb/:filename/:size", handlers.GenerateThumb)
			authorized.POST("/transfer/regenerate-thumbs", handlers.RegenerateThumbs)

			// Config Versions
			authorized.GET("/config-versions", handlers.GetConfigVersions)
			authorized.POST("/config-versions", handlers.SaveConfigVersion)
			authorized.POST("/config-versions/restore", handlers.RestoreConfigVersion)
			authorized.DELETE("/config-versions/:id", handlers.DeleteConfigVersion)
		}
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	host := strings.TrimSpace(os.Getenv("HOST"))
	if host == "" {
		host = "0.0.0.0"
	}
	addr := host + ":" + port
	log.Printf("Server starting on %s (basePath=%s)", addr, func() string {
		if basePath == "" {
			return "/"
		}
		return basePath
	}())
	if err := r.Run(addr); err != nil {
		log.Fatal("Server failed to start: ", err)
	}
	log.Println("Server stopped")
	select {}
}
