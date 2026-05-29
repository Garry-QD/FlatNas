package handlers

import (
	"crypto/sha256"
	"flatnasgo-backend/config"
	"flatnasgo-backend/models"
	"flatnasgo-backend/utils"
	"flatnasgo-backend/ws"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	socketio "github.com/googollee/go-socket.io"
)

var socketServer *socketio.Server

type getDataCacheEntry struct {
	dataMod    time.Time
	sysMod     time.Time
	response   map[string]interface{}
	accessTime time.Time
}

var getDataCache = map[string]getDataCacheEntry{}
var getDataCacheMu sync.RWMutex
var memoFileMu sync.Mutex
var memoSaveIdempotencyCache = map[string]memoSaveIdempotencyEntry{}
var memoSaveIdempotencyMu sync.Mutex

const maxCacheEntries = 20

func getDataCacheEvictIfNeeded() {
	for len(getDataCache) > maxCacheEntries {
		oldestKey := ""
		oldestTime := time.Now()
		for k, v := range getDataCache {
			if v.accessTime.Before(oldestTime) {
				oldestKey = k
				oldestTime = v.accessTime
			}
		}
		if oldestKey != "" {
			delete(getDataCache, oldestKey)
		}
	}
}

const memoSaveIdempotencyTTL = 10 * time.Minute

var (
	sysConfigCache    models.SystemConfig
	sysConfigCacheMu  sync.RWMutex
	sysConfigCacheMod time.Time
)

func getCachedSystemConfig() models.SystemConfig {
	info, err := os.Stat(config.SystemConfigFile)
	if err != nil {
		return loadSystemConfigFromDisk()
	}
	sysConfigCacheMu.RLock()
	if sysConfigCacheMod.Equal(info.ModTime()) {
		cached := sysConfigCache
		sysConfigCacheMu.RUnlock()
		return cached
	}
	sysConfigCacheMu.RUnlock()
	return loadSystemConfigFromDisk()
}

func loadSystemConfigFromDisk() models.SystemConfig {
	var cfg models.SystemConfig
	if err := utils.ReadJSON(config.SystemConfigFile, &cfg); err != nil {
		return cfg
	}
	info, err := os.Stat(config.SystemConfigFile)
	if err == nil {
		sysConfigCacheMu.Lock()
		sysConfigCache = cfg
		sysConfigCacheMod = info.ModTime()
		sysConfigCacheMu.Unlock()
	}
	return cfg
}

type MemoFileData struct {
	Content  string `json:"content"`
	ServerTS int64  `json:"server_ts"`
	Mode     string `json:"mode,omitempty"`
}

type SaveMemoPayload struct {
	Content         string  `json:"content"`
	ServerTS        *int64  `json:"server_ts"`
	Mode            *string `json:"mode"`
	ClientRequestID *string `json:"client_request_id,omitempty"`
}

type memoSaveIdempotencyEntry struct {
	Status    int
	Body      gin.H
	CreatedAt time.Time
}

func normalizeMemoRequestID(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	if len(s) > 128 {
		s = s[:128]
	}
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == ':' || r == '.' {
			b.WriteRune(r)
		}
	}
	return strings.TrimSpace(b.String())
}

func memoSaveIdempotencyGet(cacheKey string) (memoSaveIdempotencyEntry, bool) {
	if cacheKey == "" {
		return memoSaveIdempotencyEntry{}, false
	}
	now := time.Now()
	memoSaveIdempotencyMu.Lock()
	defer memoSaveIdempotencyMu.Unlock()
	for k, v := range memoSaveIdempotencyCache {
		if now.Sub(v.CreatedAt) > memoSaveIdempotencyTTL {
			delete(memoSaveIdempotencyCache, k)
		}
	}
	entry, ok := memoSaveIdempotencyCache[cacheKey]
	if !ok {
		return memoSaveIdempotencyEntry{}, false
	}
	return memoSaveIdempotencyEntry{
		Status:    entry.Status,
		Body:      cloneGinH(entry.Body),
		CreatedAt: entry.CreatedAt,
	}, true
}

func memoSaveIdempotencySet(cacheKey string, status int, body gin.H) {
	if cacheKey == "" {
		return
	}
	now := time.Now()
	memoSaveIdempotencyMu.Lock()
	defer memoSaveIdempotencyMu.Unlock()
	for k, v := range memoSaveIdempotencyCache {
		if now.Sub(v.CreatedAt) > memoSaveIdempotencyTTL {
			delete(memoSaveIdempotencyCache, k)
		}
	}
	memoSaveIdempotencyCache[cacheKey] = memoSaveIdempotencyEntry{
		Status:    status,
		Body:      cloneGinH(body),
		CreatedAt: now,
	}
}

func cloneGinH(src gin.H) gin.H {
	out := gin.H{}
	for k, v := range src {
		out[k] = v
	}
	return out
}

func normalizeVersion(v interface{}) int64 {
	switch t := v.(type) {
	case float64:
		return int64(t)
	case int:
		return int64(t)
	case int64:
		return t
	case string:
		if n, err := strconv.ParseInt(t, 10, 64); err == nil {
			return n
		}
	}
	return 0
}

func removeSensitiveFields(value interface{}, keys map[string]struct{}) {
	switch v := value.(type) {
	case map[string]interface{}:
		for k, item := range v {
			if _, ok := keys[k]; ok {
				delete(v, k)
				continue
			}
			removeSensitiveFields(item, keys)
		}
	case []interface{}:
		for _, item := range v {
			removeSensitiveFields(item, keys)
		}
	}
}

func normalizeEmbeddedAssetString(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if !strings.HasPrefix(trimmed, "data:image/") {
		return raw, false
	}
	path, _, err := cacheIconDataURLValue(trimmed)
	if err != nil {
		log.Printf("[data-normalize] failed to cache embedded image: code=%s", err.Code)
		return raw, false
	}
	return path, true
}

func normalizeEmbeddedAssetRefs(value interface{}) bool {
	changed := false
	switch v := value.(type) {
	case map[string]interface{}:
		for key, item := range v {
			switch typed := item.(type) {
			case string:
				if key != "icon" && key != "backgroundImage" {
					continue
				}
				if next, ok := normalizeEmbeddedAssetString(typed); ok {
					v[key] = next
					changed = true
				}
			case map[string]interface{}, []interface{}:
				if normalizeEmbeddedAssetRefs(typed) {
					changed = true
				}
			}
		}
	case []interface{}:
		for _, item := range v {
			switch typed := item.(type) {
			case map[string]interface{}, []interface{}:
				if normalizeEmbeddedAssetRefs(typed) {
					changed = true
				}
			}
		}
	}
	return changed
}

func SetSocketServer(server *socketio.Server) {
	socketServer = server
}

func latestModTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func buildGetDataETag(username, userFile string, isGuest bool, dataMod, sysMod time.Time, dataSize int64) string {
	payload := fmt.Sprintf(
		"%s|%s|%t|%d|%d|%d",
		username,
		userFile,
		isGuest,
		dataMod.UnixNano(),
		sysMod.UnixNano(),
		dataSize,
	)
	sum := sha256.Sum256([]byte(payload))
	return fmt.Sprintf("\"%x\"", sum[:])
}

func normalizeETagToken(raw string) string {
	token := strings.TrimSpace(raw)
	token = strings.TrimPrefix(token, "W/")
	return token
}

func requestHasMatchingETag(c *gin.Context, etag string) bool {
	if etag == "" {
		return false
	}
	raw := strings.TrimSpace(c.GetHeader("If-None-Match"))
	if raw == "" {
		return false
	}
	if raw == "*" {
		return true
	}
	want := normalizeETagToken(etag)
	for _, candidate := range strings.Split(raw, ",") {
		if normalizeETagToken(candidate) == want {
			return true
		}
	}
	return false
}

func setGetDataCacheHeaders(c *gin.Context, etag string, dataMod, sysMod time.Time) {
	c.Header("Cache-Control", "private, no-cache, must-revalidate")
	c.Header("Vary", "Authorization")
	if etag != "" {
		c.Header("ETag", etag)
	}
	if latest := latestModTime(dataMod, sysMod); !latest.IsZero() {
		c.Header("Last-Modified", latest.UTC().Format(http.TimeFormat))
	}
}

func GetData(c *gin.Context) {
	start := time.Now()
	username := c.GetString("username")
	isGuest := false
	if username == "" {
		username = "admin"
		isGuest = true
	}

	sysConfig := getCachedSystemConfig()
	sysInfo, sysStatErr := os.Stat(config.SystemConfigFile)
	sysMod := time.Time{}
	if sysStatErr == nil {
		sysMod = sysInfo.ModTime()
	}

	userFile := filepath.Join(config.UsersDir, username+".json")
	if username == "admin" && sysConfig.AuthMode == "single" {
		userFile = filepath.Join(config.DataDir, "data.json")
	}

	userStatStart := time.Now()
	userInfo, userStatErr := os.Stat(userFile)
	userStatMs := time.Since(userStatStart).Milliseconds()
	dataMod := time.Time{}
	dataSize := int64(0)
	if userStatErr == nil {
		dataMod = userInfo.ModTime()
		dataSize = userInfo.Size()
	}
	etag := ""
	if userStatErr == nil {
		etag = buildGetDataETag(username, userFile, isGuest, dataMod, sysMod, dataSize)
	}
	setGetDataCacheHeaders(c, etag, dataMod, sysMod)
	if requestHasMatchingETag(c, etag) {
		c.Status(http.StatusNotModified)
		return
	}

	cacheKey := userFile
	if isGuest {
		cacheKey += "|guest"
	} else {
		cacheKey += "|auth"
	}
	if userStatErr == nil && !sysMod.IsZero() {
		getDataCacheMu.RLock()
		entry, ok := getDataCache[cacheKey]
		getDataCacheMu.RUnlock()
		if ok && entry.dataMod.Equal(dataMod) && entry.sysMod.Equal(sysMod) {
			getDataCacheMu.Lock()
			entry.accessTime = time.Now()
			getDataCache[cacheKey] = entry
			getDataCacheMu.Unlock()
			totalMs := time.Since(start).Milliseconds()
			log.Printf("GetData cache hit user=%s guest=%v userStatMs=%d totalMs=%d", username, isGuest, userStatMs, totalMs)
			c.JSON(http.StatusOK, entry.response)
			return
		}
	}

	// Use map[string]interface{} to preserve all fields
	var userData map[string]interface{}
	userReadStart := time.Now()
	if err := utils.ReadJSON(userFile, &userData); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User data not found"})
		return
	}
	userReadMs := time.Since(userReadStart).Milliseconds()
	if normalizeEmbeddedAssetRefs(userData) {
		if err := utils.WriteJSON(userFile, userData); err != nil {
			log.Printf("GetData normalize write failed user=%s file=%s err=%v", username, userFile, err)
		} else {
			if refreshedInfo, statErr := os.Stat(userFile); statErr == nil {
				dataMod = refreshedInfo.ModTime()
				dataSize = refreshedInfo.Size()
				etag = buildGetDataETag(username, userFile, isGuest, dataMod, sysMod, dataSize)
				setGetDataCacheHeaders(c, etag, dataMod, sysMod)
			}
		}
	}

	// Remove password from response
	delete(userData, "password")

	filterStart := time.Now()
	if isGuest {
		allowGuestLanAccess := false
		if appConfig, ok := userData["appConfig"].(map[string]interface{}); ok {
			if v, ok := appConfig["allowGuestLanAccess"].(bool); ok && v {
				allowGuestLanAccess = true
			}
		}

		// Filter public items manually in the map structure
		// This is tricky with untyped map, but necessary to preserve data integrity
		if groups, ok := userData["groups"].([]interface{}); ok {
			var filteredGroups []interface{}
			for _, g := range groups {
				if groupMap, ok := g.(map[string]interface{}); ok {
					if items, ok := groupMap["items"].([]interface{}); ok {
						var publicItems []interface{}
						for _, item := range items {
							if itemMap, ok := item.(map[string]interface{}); ok {
								if isPublic, ok := itemMap["isPublic"].(bool); ok && isPublic {
									publicItems = append(publicItems, itemMap)
								}
							}
						}
						// Only keep group if it has public items (or maybe keep empty groups?)
						// Previous logic: if len(publicItems) > 0 { ... }
						if len(publicItems) > 0 {
							groupMap["items"] = publicItems
							filteredGroups = append(filteredGroups, groupMap)
						}
					}
				}
			}
			userData["groups"] = filteredGroups
		}

		if widgets, ok := userData["widgets"].([]interface{}); ok {
			var filteredWidgets []interface{}
			for _, w := range widgets {
				if widgetMap, ok := w.(map[string]interface{}); ok {
					if isPublic, ok := widgetMap["isPublic"].(bool); ok && isPublic {
						filteredWidgets = append(filteredWidgets, widgetMap)
					}
				}
			}
			userData["widgets"] = filteredWidgets
		}

		if !allowGuestLanAccess {
			sensitiveKeys := map[string]struct{}{
				"lanUrl":             {},
				"backupLanUrls":      {},
				"lanHost":            {},
				"lanProbeTarget":     {},
			}
			removeSensitiveFields(userData, sensitiveKeys)
		}
	}
	filterMs := time.Since(filterStart).Milliseconds()

	// Inject system config
	userData["systemConfig"] = sysConfig
	// Single-user mode must always present as admin, even if old data files carry stale usernames.
	if sysConfig.AuthMode == "single" && username == "admin" {
		userData["username"] = "admin"
	} else if _, ok := userData["username"]; !ok {
		// Inject username if missing (for consistency)
		userData["username"] = username
	}
	if _, ok := userData["version"]; !ok {
		userData["version"] = int64(0)
	}

	// Align memo widget data with memo files to avoid rollback on full refresh
	if widgets, ok := userData["widgets"].([]interface{}); ok {
		for _, w := range widgets {
			widgetMap, ok := w.(map[string]interface{})
			if !ok {
				continue
			}
			wType, _ := widgetMap["type"].(string)
			if wType != "memo" {
				continue
			}
			widgetID, _ := widgetMap["id"].(string)
			if widgetID == "" {
				continue
			}
			memoFile := memoFilePath(username, widgetID)
			memoFileMu.Lock()
			data, err := ensureMemoFile(userFile, memoFile, widgetID, widgetMap["data"], userData)
			memoFileMu.Unlock()
			if err != nil {
				continue
			}
			widgetMap["data"] = data
		}
	}

	if userStatErr == nil && !sysMod.IsZero() {
		getDataCacheMu.Lock()
		getDataCacheEvictIfNeeded()
		getDataCache[cacheKey] = getDataCacheEntry{
			dataMod:    dataMod,
			sysMod:     sysMod,
			response:   userData,
			accessTime: time.Now(),
		}
		getDataCacheMu.Unlock()
	}
	totalMs := time.Since(start).Milliseconds()
	log.Printf("GetData cache miss user=%s guest=%v userStatMs=%d userReadMs=%d filterMs=%d totalMs=%d", username, isGuest, userStatMs, userReadMs, filterMs, totalMs)

	c.JSON(http.StatusOK, userData)
}

// GetVersion 返回当前用户数据的版本号，用于前端激活时轻量检查是否需同步
func GetVersion(c *gin.Context) {
	username := c.GetString("username")
	if username == "" {
		username = "admin"
	}
	sysConfig := getCachedSystemConfig()
	userFile := filepath.Join(config.UsersDir, username+".json")
	if username == "admin" && sysConfig.AuthMode == "single" {
		userFile = filepath.Join(config.DataDir, "data.json")
	}

	// 先查缓存
	getDataCacheMu.RLock()
	entry, ok := getDataCache[userFile+"|auth"]
	getDataCacheMu.RUnlock()
	if ok {
		if v, exists := entry.response["version"]; exists {
			c.JSON(http.StatusOK, gin.H{"version": normalizeVersion(v)})
			return
		}
	}

	// 缓存未命中才读文件
	var userData map[string]interface{}
	if err := utils.ReadJSON(userFile, &userData); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User data not found"})
		return
	}
	v := normalizeVersion(userData["version"])
	c.JSON(http.StatusOK, gin.H{"version": v})
}

func GetWidget(c *gin.Context) {
	username := c.GetString("username")
	if username == "" {
		username = "admin"
	}

	sysConfig := getCachedSystemConfig()

	userFile := filepath.Join(config.UsersDir, username+".json")
	if username == "admin" && sysConfig.AuthMode == "single" {
		userFile = filepath.Join(config.DataDir, "data.json")
	}

	var userData map[string]interface{}
	if err := utils.ReadJSON(userFile, &userData); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User data not found"})
		return
	}

	widgets, ok := userData["widgets"].([]interface{})
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Widgets not found"})
		return
	}

	id := c.Param("id")
	for _, w := range widgets {
		if widgetMap, ok := w.(map[string]interface{}); ok {
			if wId, ok := widgetMap["id"].(string); ok && wId == id {
				data, _ := widgetMap["data"]
				c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
				return
			}
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "Widget not found"})
}

func sanitizeMemoID(raw string) string {
	var b strings.Builder
	for _, r := range raw {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	s := strings.Trim(b.String(), "_")
	if s == "" {
		return "memo"
	}
	return s
}

func memoFilePath(username, widgetID string) string {
	safeUser := sanitizeMemoID(username)
	safeWidget := sanitizeMemoID(widgetID)
	return filepath.Join(config.DataDir, "memo_"+safeUser+"_"+safeWidget+".json")
}

func extractMemoContentFromWidgetData(data interface{}) string {
	if text, ok := data.(string); ok {
		return text
	}
	obj, ok := data.(map[string]interface{})
	if !ok {
		return ""
	}
	if content, ok := obj["content"].(string); ok {
		return content
	}
	if rich, ok := obj["rich"].(string); ok {
		return rich
	}
	if simple, ok := obj["simple"].(string); ok {
		return simple
	}
	return ""
}

func loadMemoFallbackContent(userFile, widgetID string) string {
	var userData map[string]interface{}
	if err := utils.ReadJSON(userFile, &userData); err != nil {
		return ""
	}
	return extractMemoFromUserData(userData, widgetID)
}

// extractMemoFromUserData 从已解析的 data.json 中查找 memo 内容，避免对每个 memo 重复读盘解析整份配置。
func extractMemoFromUserData(userData map[string]interface{}, widgetID string) string {
	if userData == nil || widgetID == "" {
		return ""
	}
	widgets, ok := userData["widgets"].([]interface{})
	if !ok {
		return ""
	}
	for _, w := range widgets {
		widgetMap, ok := w.(map[string]interface{})
		if !ok {
			continue
		}
		wID, ok := widgetMap["id"].(string)
		if !ok || wID != widgetID {
			continue
		}
		return extractMemoContentFromWidgetData(widgetMap["data"])
	}
	return ""
}

func ensureMemoFile(userFile, memoFile, widgetID string, preloadedData interface{}, userData map[string]interface{}) (MemoFileData, error) {
	var data MemoFileData
	if err := utils.ReadJSON(memoFile, &data); err == nil {
		if data.Mode != "simple" && data.Mode != "rich" {
			if strings.Contains(data.Content, "<") && strings.Contains(data.Content, ">") {
				data.Mode = "rich"
			} else {
				data.Mode = "simple"
			}
		}
		return data, nil
	}
	if _, err := os.Stat(memoFile); err == nil {
		return data, nil
	} else if !os.IsNotExist(err) {
		return data, err
	}
	content := ""
	if preloadedData != nil {
		content = extractMemoContentFromWidgetData(preloadedData)
	}
	if content == "" && userData != nil {
		content = extractMemoFromUserData(userData, widgetID)
	}
	if content == "" {
		content = loadMemoFallbackContent(userFile, widgetID)
	}
	serverTS := int64(0)
	if content != "" {
		serverTS = time.Now().UnixMilli()
	}
	initial := MemoFileData{
		Content:  content,
		ServerTS: serverTS,
		Mode: func() string {
			if strings.Contains(content, "<") && strings.Contains(content, ">") {
				return "rich"
			}
			return "simple"
		}(),
	}
	if err := utils.WriteJSON(memoFile, initial); err != nil {
		return MemoFileData{}, err
	}
	return initial, nil
}

func GetMemo(c *gin.Context) {
	username := c.GetString("username")
	if username == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	widgetID := c.Param("id")
	if widgetID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Widget ID is required"})
		return
	}

	sysConfig := getCachedSystemConfig()
	userFile := filepath.Join(config.UsersDir, username+".json")
	if username == "admin" && sysConfig.AuthMode == "single" {
		userFile = filepath.Join(config.DataDir, "data.json")
	}
	memoFile := memoFilePath(username, widgetID)

	memoFileMu.Lock()
	defer memoFileMu.Unlock()
	data, err := ensureMemoFile(userFile, memoFile, widgetID, nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read memo"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

func SaveMemo(c *gin.Context) {
	username := c.GetString("username")
	if username == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}
	widgetID := c.Param("id")
	if widgetID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Widget ID is required"})
		return
	}

	var payload SaveMemoPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
		return
	}

	requestID := normalizeMemoRequestID(c.GetHeader("X-Idempotency-Key"))
	if requestID == "" && payload.ClientRequestID != nil {
		requestID = normalizeMemoRequestID(*payload.ClientRequestID)
	}
	idempotencyKey := ""
	if requestID != "" {
		idempotencyKey = username + "|" + widgetID + "|" + requestID
		if cached, ok := memoSaveIdempotencyGet(idempotencyKey); ok {
			c.JSON(cached.Status, cached.Body)
			return
		}
	}

	if payload.ServerTS == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "server_ts is required"})
		return
	}
	if payload.Mode != nil && *payload.Mode != "simple" && *payload.Mode != "rich" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "mode must be simple or rich"})
		return
	}

	sysConfig := getCachedSystemConfig()
	userFile := filepath.Join(config.UsersDir, username+".json")
	if username == "admin" && sysConfig.AuthMode == "single" {
		userFile = filepath.Join(config.DataDir, "data.json")
	}
	memoFile := memoFilePath(username, widgetID)

	memoFileMu.Lock()
	defer memoFileMu.Unlock()

	current, err := ensureMemoFile(userFile, memoFile, widgetID, nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read memo"})
		return
	}
	if *payload.ServerTS != current.ServerTS {
		body := gin.H{
			"error": "Version conflict",
			"data":  current,
		}
		memoSaveIdempotencySet(idempotencyKey, http.StatusConflict, body)
		c.JSON(http.StatusConflict, body)
		return
	}

	nextTS := time.Now().UnixMilli()
	if nextTS <= current.ServerTS {
		nextTS = current.ServerTS + 1
	}
	nextMode := current.Mode
	if payload.Mode != nil {
		nextMode = *payload.Mode
	}
	if nextMode != "simple" && nextMode != "rich" {
		if strings.Contains(payload.Content, "<") && strings.Contains(payload.Content, ">") {
			nextMode = "rich"
		} else {
			nextMode = "simple"
		}
	}
	next := MemoFileData{
		Content:  payload.Content,
		ServerTS: nextTS,
		Mode:     nextMode,
	}
	if err := utils.WriteJSON(memoFile, next); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save memo"})
		return
	}

	if socketServer != nil {
		socketServer.BroadcastToRoom("/", SocketUserRoom(username), "memo:updated", map[string]interface{}{
			"widgetId": widgetID,
			"content":  next,
			"username": username,
		})
	}
	if b := ws.GetBroadcaster(); b != nil {
		ws.BroadcastMemoUpdated(b.Manager, username, widgetID, next)
	}

	body := gin.H{"success": true, "data": next}
	memoSaveIdempotencySet(idempotencyKey, http.StatusOK, body)
	c.JSON(http.StatusOK, body)
}

func SaveData(c *gin.Context) {
	start := time.Now() // 记录开始时间，监控慢请求
	username := c.GetString("username")
	if username == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// 1. Bind to map to capture EVERYTHING sent by frontend
	var payload map[string]interface{}
	if err := c.ShouldBindJSON(&payload); err != nil {
		log.Printf("SaveData 解析 JSON 失败 user=%s err=%v elapsed=%dms", username, err, time.Since(start).Milliseconds())
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
		return
	}

	sysConfig := getCachedSystemConfig()

	userFile := filepath.Join(config.UsersDir, username+".json")
	if username == "admin" && sysConfig.AuthMode == "single" {
		userFile = filepath.Join(config.DataDir, "data.json")
	}

	// 2. Read existing data to map to preserve EVERYTHING in file
	var existingData map[string]interface{}
	utils.ReadJSON(userFile, &existingData)
	if existingData == nil {
		existingData = make(map[string]interface{})
	}
	existingVersion := normalizeVersion(existingData["version"])
	clientVersion := int64(0)
	hasClientVersion := false
	if v, ok := payload["version"]; ok {
		clientVersion = normalizeVersion(v)
		hasClientVersion = true
	}
	if hasClientVersion && clientVersion != existingVersion {
		c.JSON(http.StatusConflict, gin.H{"error": "Version conflict", "currentVersion": existingVersion})
		return
	}
	newVersion := existingVersion + 1
	payload["version"] = newVersion

	// 3. Handle Password Hashing
	// Check if payload has a password string
	if pwd, ok := payload["password"].(string); ok && pwd != "" {
		// Hash new password
		hashed, err := utils.HashPassword(pwd)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
			return
		}
		payload["password"] = hashed
	} else {
		// Keep existing password
		if existingPwd, ok := existingData["password"]; ok {
			payload["password"] = existingPwd
		}
	}

	// 4. Merge other fields?
	// Actually, payload contains the full state of groups, widgets, appConfig etc.
	// So we can just use payload as the new state, but we should preserve top-level keys
	// that might be missing in payload but present in existingData (if any).
	// Frontend sends: groups, widgets, appConfig, rssFeeds, rssCategories.
	// If there are other top-level keys in existingData (like "created_at"?), we might want to keep them.
	for k, v := range existingData {
		if _, exists := payload[k]; !exists {
			payload[k] = v
		}
	}

	// Clean up legacy "items" field if "groups" is present in payload
	// This prevents the issue where deleting all groups causes legacy items to reappear as a "Default Group"
	if _, hasGroups := payload["groups"]; hasGroups {
		delete(payload, "items")
	}

	// Single-user mode always persists as admin to avoid stale imported usernames leaking back.
	if username == "admin" && sysConfig.AuthMode == "single" {
		payload["username"] = "admin"
	} else if _, ok := payload["username"]; !ok {
		// Ensure username is set
		payload["username"] = username
	}
	normalizeEmbeddedAssetRefs(payload)

	if err := utils.WriteJSON(userFile, payload); err != nil {
		log.Printf("SaveData 写入文件失败 user=%s file=%s err=%v elapsed=%dms", username, userFile, err, time.Since(start).Milliseconds())
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save data"})
		return
	}

	// Trigger weather poll for new cities
	oldCities := GetCitiesFromPayload(existingData)
	newCities := GetCitiesFromPayload(payload)
	sharedWeatherPoller.TriggerPollForNewCities(oldCities, newCities)

	elapsed := time.Since(start).Milliseconds()
	// 慢请求告警（超过 5 秒）
	if elapsed > 5000 {
		log.Printf("SaveData 慢请求告警 user=%s elapsed=%dms version=%d", username, elapsed, newVersion)
	} else {
		log.Printf("SaveData 成功 user=%s elapsed=%dms version=%d", username, elapsed, newVersion)
	}

	if socketServer != nil {
		socketServer.BroadcastToRoom("/", SocketUserRoom(username), "data-updated", map[string]interface{}{
			"username": username,
			"version":  newVersion,
		})
	}
	if b := ws.GetBroadcaster(); b != nil {
		ws.BroadcastDataUpdated(b.Manager, username, newVersion)
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "version": newVersion})
}

// ImportData handles importing JSON configuration
func ImportData(c *gin.Context) {
	// Re-use SaveData logic as it handles the exact same payload structure
	SaveData(c)
}

func SaveDefault(c *gin.Context) {
	username := c.GetString("username")
	// Only allow authenticated users (and maybe check for admin if needed, but for now just auth)
	if username == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	sysConfig := getCachedSystemConfig()

	// Identify current user's file
	userFile := filepath.Join(config.UsersDir, username+".json")
	if username == "admin" && sysConfig.AuthMode == "single" {
		userFile = filepath.Join(config.DataDir, "data.json")
	}

	// Read current data
	var userData map[string]interface{}
	if err := utils.ReadJSON(userFile, &userData); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User data not found"})
		return
	}

	// Remove sensitive/user-specific data before saving as default
	delete(userData, "password")
	delete(userData, "username")
	delete(userData, "created_at")

	// Save to default.json
	if err := utils.WriteJSON(config.DefaultFile, userData); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save default template"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

func ResetData(c *gin.Context) {
	username := c.GetString("username")
	if username == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Load default data
	var defaultData map[string]interface{}
	if err := utils.ReadJSON(config.DefaultFile, &defaultData); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Default template not found"})
		return
	}

	// Determine user file
	sysConfig := getCachedSystemConfig()

	userFile := filepath.Join(config.UsersDir, username+".json")
	if username == "admin" && sysConfig.AuthMode == "single" {
		userFile = filepath.Join(config.DataDir, "data.json")
	}

	// Read current data to preserve password/username
	var currentData map[string]interface{}
	utils.ReadJSON(userFile, &currentData)

	// Merge: Use default data, but keep current password and username
	if currentData != nil {
		if pwd, ok := currentData["password"]; ok {
			defaultData["password"] = pwd
		}
		if sysConfig.AuthMode == "single" && username == "admin" {
			defaultData["username"] = "admin"
		} else if usr, ok := currentData["username"]; ok {
			defaultData["username"] = usr
		}
	} else {
		// If current data is missing, ensure username is set
		if sysConfig.AuthMode == "single" && username == "admin" {
			defaultData["username"] = "admin"
		} else {
			defaultData["username"] = username
		}
		// Password might be missing if it was empty
	}

	if err := utils.WriteJSON(userFile, defaultData); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reset data"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

func GetSystemConfig(c *gin.Context) {
	sysConfig := getCachedSystemConfig()
	c.JSON(http.StatusOK, sysConfig)
}

func UpdateSystemConfig(c *gin.Context) {
	username := c.GetString("username")
	if username != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
		return
	}

	var payload map[string]interface{}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
		return
	}

	sysConfig := getCachedSystemConfig()
	oldAuthMode := sysConfig.AuthMode

	if v, ok := payload["authMode"].(string); ok {
		if v != "single" && v != "multi" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid authMode"})
			return
		}
		sysConfig.AuthMode = v
	}

	if v, ok := payload["enableDocker"].(bool); ok {
		sysConfig.EnableDocker = v
	}
	if v, ok := payload["dockerHost"].(string); ok {
		sysConfig.DockerHost = v
	}

	if sysConfig.AuthMode != oldAuthMode {
		if err := migrateAuthModeData(oldAuthMode, sysConfig.AuthMode); err != nil {
			log.Printf("UpdateSystemConfig: data migration failed: %v", err)
		}
	}

	if err := utils.WriteJSON(config.SystemConfigFile, sysConfig); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update system config"})
		return
	}

	InitDocker()

	c.JSON(http.StatusOK, sysConfig)
}

func migrateAuthModeData(from, to string) error {
	dataFile := filepath.Join(config.DataDir, "data.json")
	adminUserFile := filepath.Join(config.UsersDir, "admin.json")

	if from == "single" && to == "multi" {
		if _, err := os.Stat(dataFile); err != nil {
			return nil
		}
		if _, err := os.Stat(adminUserFile); err == nil {
			return nil
		}
		src, err := os.ReadFile(dataFile)
		if err != nil {
			return err
		}
		return os.WriteFile(adminUserFile, src, 0644)
	}

	if from == "multi" && to == "single" {
		if _, err := os.Stat(adminUserFile); err != nil {
			return nil
		}
		src, err := os.ReadFile(adminUserFile)
		if err != nil {
			return err
		}
		return os.WriteFile(dataFile, src, 0644)
	}

	return nil
}

func StartDataWarmup() {
	go func() {
		dataFile := filepath.Join(config.DataDir, "data.json")
		if _, err := os.Stat(dataFile); err != nil {
			if os.IsNotExist(err) {
				time.Sleep(5 * time.Second)
			} else {
				return
			}
		}

		var payload map[string]interface{}
		if err := utils.ReadJSON(dataFile, &payload); err != nil {
			return
		}

		rssUrls := extractRssUrls(payload)
		if len(rssUrls) > 0 {
			WarmRssCache(rssUrls)
		}

		weatherPayloads := extractWeatherPayloads(payload)
		if len(weatherPayloads) > 0 {
			WarmWeatherCache(weatherPayloads)
		}
	}()
}

func extractRssUrls(payload map[string]interface{}) []string {
	feeds, ok := payload["rssFeeds"].([]interface{})
	if !ok {
		return nil
	}
	urls := make([]string, 0)
	seen := make(map[string]struct{})
	for _, feed := range feeds {
		fm, ok := feed.(map[string]interface{})
		if !ok {
			continue
		}
		enabled, _ := fm["enable"].(bool)
		if !enabled {
			continue
		}
		url, _ := fm["url"].(string)
		url = strings.TrimSpace(url)
		if url == "" {
			continue
		}
		if _, exists := seen[url]; exists {
			continue
		}
		seen[url] = struct{}{}
		urls = append(urls, url)
	}
	return urls
}

type weatherKey struct {
	city       string
	source     string
	key        string
	projectId  string
	keyId      string
	privateKey string
}

func extractWeatherPayloads(payload map[string]interface{}) []WeatherPayload {
	appConfig, _ := payload["appConfig"].(map[string]interface{})
	source, _ := appConfig["weatherSource"].(string)
	key, _ := appConfig["amapKey"].(string)
	projectId, _ := appConfig["qweatherProjectId"].(string)
	keyId, _ := appConfig["qweatherKeyId"].(string)
	privateKey, _ := appConfig["qweatherPrivateKey"].(string)

	widgets, ok := payload["widgets"].([]interface{})
	if !ok {
		return nil
	}
	payloads := make([]WeatherPayload, 0)
	seen := make(map[weatherKey]struct{})
	for _, widget := range widgets {
		wm, ok := widget.(map[string]interface{})
		if !ok {
			continue
		}
		enabled, _ := wm["enable"].(bool)
		if !enabled {
			continue
		}
		wType, _ := wm["type"].(string)
		if wType != "weather" && wType != "clockweather" {
			continue
		}
		data, _ := wm["data"].(map[string]interface{})
		city, _ := data["city"].(string)
		city = strings.TrimSpace(city)
		if city == "" {
			continue
		}
		keyObj := weatherKey{
			city:       city,
			source:     source,
			key:        key,
			projectId:  projectId,
			keyId:      keyId,
			privateKey: privateKey,
		}
		if _, exists := seen[keyObj]; exists {
			continue
		}
		seen[keyObj] = struct{}{}
		payloads = append(payloads, WeatherPayload{
			City:       city,
			Source:     source,
			Key:        key,
			ProjectId:  projectId,
			KeyId:      keyId,
			PrivateKey: privateKey,
		})
	}
	return payloads
}
