package handlers

import (
	"encoding/json"
	"flatnasgo-backend/config"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type assetMetaEntry struct {
	Owner *string `json:"owner"`
}

type assetMetaStore struct {
	Music             map[string]assetMetaEntry `json:"music"`
	Backgrounds       map[string]assetMetaEntry `json:"backgrounds"`
	MobileBackgrounds map[string]assetMetaEntry `json:"mobileBackgrounds"`
}

var assetMetaMu sync.Mutex

func assetMetaFilePath() string {
	return filepath.Join(config.DataDir, "asset_meta.json")
}

func ensureAssetMetaMaps(store *assetMetaStore) {
	if store.Music == nil {
		store.Music = map[string]assetMetaEntry{}
	}
	if store.Backgrounds == nil {
		store.Backgrounds = map[string]assetMetaEntry{}
	}
	if store.MobileBackgrounds == nil {
		store.MobileBackgrounds = map[string]assetMetaEntry{}
	}
}

func loadAssetMetaStoreUnlocked() (assetMetaStore, error) {
	store := assetMetaStore{
		Music:             map[string]assetMetaEntry{},
		Backgrounds:       map[string]assetMetaEntry{},
		MobileBackgrounds: map[string]assetMetaEntry{},
	}
	data, err := os.ReadFile(assetMetaFilePath())
	if err != nil {
		if os.IsNotExist(err) {
			return store, nil
		}
		return store, err
	}
	if len(data) == 0 {
		return store, nil
	}
	if err := json.Unmarshal(data, &store); err != nil {
		return store, err
	}
	ensureAssetMetaMaps(&store)
	return store, nil
}

func saveAssetMetaStoreUnlocked(store assetMetaStore) error {
	ensureAssetMetaMaps(&store)
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(assetMetaFilePath(), data, 0644)
}

func normalizeAssetKey(raw string) string {
	return strings.TrimPrefix(strings.ReplaceAll(strings.TrimSpace(raw), "\\", "/"), "/")
}

func canAccessOwnedAsset(owner *string, username string) bool {
	if owner == nil {
		return true
	}
	trimmed := strings.TrimSpace(*owner)
	if trimmed == "" {
		return true
	}
	return username != "" && trimmed == username
}

func isSupportedWallpaperFile(name string) bool {
	lower := strings.ToLower(name)
	return strings.HasSuffix(lower, ".jpg") || strings.HasSuffix(lower, ".jpeg") ||
		strings.HasSuffix(lower, ".png") || strings.HasSuffix(lower, ".gif") ||
		strings.HasSuffix(lower, ".webp") || strings.HasSuffix(lower, ".svg")
}

func syncWallpaperMetaWithDir(store map[string]assetMetaEntry, dir string) (bool, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	changed := false
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !isSupportedWallpaperFile(name) {
			continue
		}
		key := normalizeAssetKey(name)
		if _, ok := store[key]; !ok {
			store[key] = assetMetaEntry{Owner: nil}
			changed = true
		}
	}
	return changed, nil
}

type WallpaperResolveRequest struct {
	URL string `json:"url"`
}

func ResolveWallpaper(c *gin.Context) {
	var req WallpaperResolveRequest
	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	parsed, err := url.Parse(req.URL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid URL"})
		return
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported protocol"})
		return
	}
	if IsBlockedHost(parsed.Hostname()) && !isAllowedWallpaperHost(parsed.Hostname()) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Target host is not allowed"})
		return
	}

	client, err := getSharedProxyClient()
	if err != nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Head(parsed.String())
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"url": req.URL})
		return
	}
	defer resp.Body.Close()

	finalURL := resp.Request.URL.String()
	c.JSON(http.StatusOK, gin.H{"url": finalURL})
}

type WallpaperFetchRequest struct {
	URL   string `json:"url"`
	Type  string `json:"type"` // "pc" or "mobile"
	Apply bool   `json:"apply"`
}

func FetchWallpaper(c *gin.Context) {
	fmt.Println("DEBUG: FetchWallpaper called")
	var req WallpaperFetchRequest
	if err := c.BindJSON(&req); err != nil {
		fmt.Printf("DEBUG: BindJSON error: %v\n", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	fmt.Printf("DEBUG: FetchWallpaper URL: %s, Type: %s\n", req.URL, req.Type)

	parsed, err := url.Parse(req.URL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid URL"})
		return
	}

	if IsBlockedHost(parsed.Hostname()) && !isAllowedWallpaperHost(parsed.Hostname()) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Target host is not allowed"})
		return
	}

	client, err := getSharedProxyClient()
	if err != nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := client.Get(req.URL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to download image"})
		return
	}
	defer resp.Body.Close()

	ct := resp.Header.Get("Content-Type")
	ext := ".jpg"
	if strings.Contains(ct, "png") {
		ext = ".png"
	} else if strings.Contains(ct, "webp") {
		ext = ".webp"
	} else if strings.Contains(ct, "gif") {
		ext = ".gif"
	} else if strings.Contains(ct, "svg") {
		ext = ".svg"
	} else if strings.Contains(ct, "jpeg") {
		ext = ".jpg"
	}

	targetDir := config.BackgroundsDir
	urlPrefix := "/backgrounds"
	prefix := "api_bg"
	if req.Type == "mobile" {
		targetDir = config.MobileBackgroundsDir
		urlPrefix = "/mobile_backgrounds"
		prefix = "api_mbg"
	}

	// Use username if available in context, otherwise admin/default
	username := "admin" // Default
	if u, exists := c.Get("username"); exists {
		username = u.(string)
	}

	filename := fmt.Sprintf("%s_%s_%d%s", prefix, username, time.Now().UnixMilli(), ext)
	outPath := filepath.Join(targetDir, filename)

	out, err := os.Create(outPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create file"})
		return
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save file"})
		return
	}

	webPath := fmt.Sprintf("%s/%s", urlPrefix, filename)
	assetMetaMu.Lock()
	store, metaErr := loadAssetMetaStoreUnlocked()
	if metaErr == nil {
		owner := username
		entry := assetMetaEntry{Owner: &owner}
		if req.Type == "mobile" {
			store.MobileBackgrounds[normalizeAssetKey(filename)] = entry
		} else {
			store.Backgrounds[normalizeAssetKey(filename)] = entry
		}
		metaErr = saveAssetMetaStoreUnlocked(store)
	}
	assetMetaMu.Unlock()
	if metaErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save wallpaper metadata"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "path": webPath, "filename": filename})
}

func ListBackgrounds(c *gin.Context) {
	listBackgrounds(c, config.BackgroundsDir)
}

func ListMobileBackgrounds(c *gin.Context) {
	listBackgrounds(c, config.MobileBackgroundsDir)
}

func listBackgrounds(c *gin.Context, dir string) {
	username := c.GetString("username")
	entries, err := os.ReadDir(dir)
	if err != nil {
		c.JSON(http.StatusOK, []string{})
		return
	}

	assetMetaMu.Lock()
	store, metaErr := loadAssetMetaStoreUnlocked()
	if metaErr != nil {
		assetMetaMu.Unlock()
		c.JSON(http.StatusInternalServerError, []string{})
		return
	}
	targetMeta := store.Backgrounds
	if dir == config.MobileBackgroundsDir {
		targetMeta = store.MobileBackgrounds
	}
	changed, syncErr := syncWallpaperMetaWithDir(targetMeta, dir)
	if syncErr != nil {
		assetMetaMu.Unlock()
		c.JSON(http.StatusInternalServerError, []string{})
		return
	}
	if changed {
		if err := saveAssetMetaStoreUnlocked(store); err != nil {
			assetMetaMu.Unlock()
			c.JSON(http.StatusInternalServerError, []string{})
			return
		}
	}
	assetMetaMu.Unlock()

	var fileInfos []os.FileInfo
	for _, entry := range entries {
		if !entry.IsDir() {
			info, err := entry.Info()
			if err == nil {
				fileInfos = append(fileInfos, info)
			}
		}
	}

	// Sort by ModTime Descending (Newest first)
	sort.Slice(fileInfos, func(i, j int) bool {
		return fileInfos[i].ModTime().After(fileInfos[j].ModTime())
	})

	var names []string
	for _, info := range fileInfos {
		name := info.Name()
		if isSupportedWallpaperFile(name) {
			entry, ok := targetMeta[normalizeAssetKey(name)]
			if !ok {
				entry = assetMetaEntry{Owner: nil}
			}
			if canAccessOwnedAsset(entry.Owner, username) {
				names = append(names, name)
			}
		}
	}
	c.JSON(http.StatusOK, names)
}

func DeleteBackground(c *gin.Context) {
	deleteBackground(c, config.BackgroundsDir)
}

func DeleteMobileBackground(c *gin.Context) {
	deleteBackground(c, config.MobileBackgroundsDir)
}

func deleteBackground(c *gin.Context, dir string) {
	name := c.Param("name")
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name required"})
		return
	}
	if strings.Contains(name, "..") || strings.Contains(name, "/") || strings.Contains(name, "\\") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid name"})
		return
	}

	// IDOR Check
	username := c.GetString("username")
	if username == "" {
		// Should not happen if authorized, but safe guard
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	assetMetaMu.Lock()
	store, metaErr := loadAssetMetaStoreUnlocked()
	if metaErr != nil {
		assetMetaMu.Unlock()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load metadata"})
		return
	}
	targetMeta := store.Backgrounds
	if dir == config.MobileBackgroundsDir {
		targetMeta = store.MobileBackgrounds
	}
	changed, syncErr := syncWallpaperMetaWithDir(targetMeta, dir)
	if syncErr != nil {
		assetMetaMu.Unlock()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to sync metadata"})
		return
	}
	entry, ok := targetMeta[normalizeAssetKey(name)]
	if !ok {
		entry = assetMetaEntry{Owner: nil}
	}
	if username != "admin" {
		if entry.Owner == nil || strings.TrimSpace(*entry.Owner) == "" || strings.TrimSpace(*entry.Owner) != username {
			assetMetaMu.Unlock()
			c.JSON(http.StatusForbidden, gin.H{"error": "Permission denied"})
			return
		}
	}

	path := filepath.Join(dir, name)
	if err := os.Remove(path); err != nil {
		assetMetaMu.Unlock()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete"})
		return
	}
	delete(targetMeta, normalizeAssetKey(name))
	if changed || true {
		if err := saveAssetMetaStoreUnlocked(store); err != nil {
			assetMetaMu.Unlock()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save metadata"})
			return
		}
	}
	assetMetaMu.Unlock()
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func UploadBackground(c *gin.Context) {
	uploadBackground(c, config.BackgroundsDir, "/backgrounds")
}

func UploadMobileBackground(c *gin.Context) {
	uploadBackground(c, config.MobileBackgroundsDir, "/mobile_backgrounds")
}

func uploadBackground(c *gin.Context, dir string, webPrefix string) {
	form, err := c.MultipartForm()
	if err != nil {
		fmt.Printf("[UploadBackground] MultipartForm error: %v\n", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Bad Request", "detail": err.Error()})
		return
	}

	type UploadedFile struct {
		Filename string `json:"filename"`
		Path     string `json:"path"`
	}
	var uploaded []UploadedFile
	username := c.GetString("username")
	if username == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	files := form.File["files"]
	assetMetaMu.Lock()
	store, metaErr := loadAssetMetaStoreUnlocked()
	if metaErr != nil {
		assetMetaMu.Unlock()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load metadata"})
		return
	}
	targetMeta := store.Backgrounds
	if dir == config.MobileBackgroundsDir {
		targetMeta = store.MobileBackgrounds
	}
	// Step 1: validate all files before touching disk (avoid partial writes)
	for _, file := range files {
		if !isSupportedWallpaperFile(file.Filename) {
			assetMetaMu.Unlock()
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf(
				"Unsupported file type: %s (supported: jpg, jpeg, png, gif, webp, svg)",
				file.Filename,
			)})
			return
		}
	}
	for i, file := range files {
		ext := strings.ToLower(filepath.Ext(file.Filename))
		ts := time.Now().UnixMilli()
		suffix := ""
		if i > 0 {
			suffix = fmt.Sprintf("_%d", i)
		}
		filename := fmt.Sprintf("custom_%d%s%s", ts, suffix, ext)
		if err := c.SaveUploadedFile(file, filepath.Join(dir, filename)); err != nil {
			assetMetaMu.Unlock()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save " + filename})
			return
		}
		owner := username
		targetMeta[normalizeAssetKey(filename)] = assetMetaEntry{Owner: &owner}
		uploaded = append(uploaded, UploadedFile{
			Filename: filename,
			Path:     fmt.Sprintf("%s/%s", webPrefix, filename),
		})
	}
	if err := saveAssetMetaStoreUnlocked(store); err != nil {
		assetMetaMu.Unlock()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save metadata"})
		return
	}
	assetMetaMu.Unlock()
	c.JSON(http.StatusOK, gin.H{"success": true, "files": uploaded})
}
