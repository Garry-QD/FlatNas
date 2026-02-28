package handlers

import (
	"flatnasgo-backend/config"
	"flatnasgo-backend/models"
	"flatnasgo-backend/utils"
	"net/http"
	"path/filepath"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// Widget 保存的全局锁，防止并发写入冲突
var widgetSaveMutex sync.Mutex

// SaveWidgetRequest 保存 Widget 的请求
type SaveWidgetRequest struct {
	Data    interface{} `json:"data"`
	Version int         `json:"version"`
}

// SaveWidgetWithVersion 带版本控制的保存 Widget 数据
func SaveWidgetWithVersion(c *gin.Context) {
	username := c.GetString("username")
	if username == "" {
		username = "admin"
	}

	widgetID := c.Param("id")

	// 解析请求
	var req SaveWidgetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	// 获取系统配置
	var sysConfig models.SystemConfig
	utils.ReadJSON(config.SystemConfigFile, &sysConfig)

	// 确定用户数据文件
	userFile := filepath.Join(config.UsersDir, username+".json")
	if username == "admin" && sysConfig.AuthMode == "single" {
		userFile = filepath.Join(config.DataDir, "data.json")
	}

	// 使用全局锁保护文件操作
	widgetSaveMutex.Lock()
	defer widgetSaveMutex.Unlock()

	// 读取当前用户数据
	var userData map[string]interface{}
	if err := utils.ReadJSON(userFile, &userData); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User data not found"})
		return
	}

	// 获取 widgets 列表
	widgets, ok := userData["widgets"].([]interface{})
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid widgets data structure"})
		return
	}

	// 查找目标 widget
	var targetWidget map[string]interface{}
	var targetIndex int = -1

	for i, w := range widgets {
		if widgetMap, ok := w.(map[string]interface{}); ok {
			if wId, ok := widgetMap["id"].(string); ok && wId == widgetID {
				targetWidget = widgetMap
				targetIndex = i
				break
			}
		}
	}

	if targetIndex == -1 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Widget not found"})
		return
	}

	// 获取服务器端当前版本号
	serverVersion := 0
	if v, ok := targetWidget["version"].(float64); ok {
		serverVersion = int(v)
	}

	// Last-Write-Wins：最新保存总是生效
	// 版本号仅用于前端判断是否是更新的数据，不阻止保存

	// 更新 widget 数据
	targetWidget["data"] = req.Data
	targetWidget["version"] = serverVersion + 1
	targetWidget["updatedAt"] = time.Now().Unix()

	// 更新列表
	widgets[targetIndex] = targetWidget
	userData["widgets"] = widgets

	// 保存到文件
	if err := utils.WriteJSON(userFile, userData); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save data"})
		return
	}

	// 清除缓存
	getDataCacheMu.Lock()
	delete(getDataCache, username)
	getDataCacheMu.Unlock()

	// 通过 Socket.IO 广播更新（如果已连接）
	if socketServer != nil {
		socketServer.BroadcastToRoom("/", "user:"+username, "memo:updated", gin.H{
			"widgetId": widgetID,
			"content":  req.Data,
		})
	}

	// 返回成功响应
	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"id":        widgetID,
		"version":   serverVersion + 1,
		"updatedAt": targetWidget["updatedAt"],
		"data":      req.Data,
	})
}

// GetWidgetWithVersion 获取带版本号的 Widget
func GetWidgetWithVersion(c *gin.Context) {
	username := c.GetString("username")
	if username == "" {
		username = "admin"
	}

	widgetID := c.Param("id")

	// 获取系统配置
	var sysConfig models.SystemConfig
	utils.ReadJSON(config.SystemConfigFile, &sysConfig)

	// 确定用户数据文件
	userFile := filepath.Join(config.UsersDir, username+".json")
	if username == "admin" && sysConfig.AuthMode == "single" {
		userFile = filepath.Join(config.DataDir, "data.json")
	}

	// 读取用户数据
	var userData map[string]interface{}
	if err := utils.ReadJSON(userFile, &userData); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User data not found"})
		return
	}

	// 获取 widgets 列表
	widgets, ok := userData["widgets"].([]interface{})
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid widgets data structure"})
		return
	}

	// 查找目标 widget
	for _, w := range widgets {
		if widgetMap, ok := w.(map[string]interface{}); ok {
			if wId, ok := widgetMap["id"].(string); ok && wId == widgetID {
				version := 0
				if v, ok := widgetMap["version"].(float64); ok {
					version = int(v)
				}

				updatedAt := int64(0)
				if t, ok := widgetMap["updatedAt"].(float64); ok {
					updatedAt = int64(t)
				}

				c.JSON(http.StatusOK, gin.H{
					"success":   true,
					"id":        widgetID,
					"data":      widgetMap["data"],
					"version":   version,
					"updatedAt": updatedAt,
				})
				return
			}
		}
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "Widget not found"})
}
