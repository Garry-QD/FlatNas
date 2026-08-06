package ws

import (
	"encoding/json"
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

// handleMemoUpdate 处理备忘录更新：收到前端更新后仅广播给同一用户的客户端
func handleMemoUpdate(client *Client, manager *WSManager, rawPayload json.RawMessage) {
	var p MemoUpdatePayload
	if err := json.Unmarshal(rawPayload, &p); err != nil {
		return
	}
	if p.WidgetID == "" || p.Content == nil {
		return
	}

	replyMsg, _ := json.Marshal(map[string]interface{}{
		"type": "memo_updated",
		"payload": map[string]interface{}{
			"widgetId": p.WidgetID,
			"content":  p.Content,
			"username": client.username,
		},
	})
	manager.BroadcastToUser(client.username, replyMsg, client.sessionID)
}

// handleTodoUpdate 处理待办更新
func handleTodoUpdate(client *Client, manager *WSManager, rawPayload json.RawMessage) {
	var p TodoUpdatePayload
	if err := json.Unmarshal(rawPayload, &p); err != nil {
		return
	}
	if p.WidgetID == "" || p.Content == nil {
		return
	}

	replyMsg, _ := json.Marshal(map[string]interface{}{
		"type": "todo_updated",
		"payload": map[string]interface{}{
			"widgetId": p.WidgetID,
			"content":  p.Content,
			"username": client.username,
		},
	})
	manager.BroadcastToUser(client.username, replyMsg, client.sessionID)
}

// handleNetworkMode 处理网络模式切换
func handleNetworkMode(client *Client, manager *WSManager, rawPayload json.RawMessage) {
	var p NetworkModePayload
	if err := json.Unmarshal(rawPayload, &p); err != nil {
		return
	}
	if !isValidNetworkMode(p.Mode) {
		return
	}

	replyMsg, _ := json.Marshal(map[string]interface{}{
		"type": "network_mode",
		"payload": map[string]interface{}{
			"mode":     p.Mode,
			"username": client.username,
		},
	})
	manager.Broadcast(replyMsg, "")
}

// handleNetworkHeartbeat 处理网络心跳，回复给发送者
func handleNetworkHeartbeat(client *Client, manager *WSManager, rawPayload json.RawMessage) {
	replyMsg, _ := json.Marshal(map[string]interface{}{
		"type": "network_heartbeat",
		"payload": map[string]interface{}{
			"ts": time.Now().UnixMilli(),
		},
	})
	manager.SendTo(client.sessionID, replyMsg)
}

func isValidNetworkMode(mode string) bool {
	switch mode {
	case "auto", "lan", "wan", "latency":
		return true
	default:
		return false
	}
}

// BroadcastMemoUpdated REST API 保存 memo 后通过 WebSocket 广播
func BroadcastMemoUpdated(manager *WSManager, username string, widgetID string, content interface{}) {
	if manager == nil {
		return
	}
	replyMsg, _ := json.Marshal(map[string]interface{}{
		"type": "memo_updated",
		"payload": map[string]interface{}{
			"widgetId": widgetID,
			"content":  content,
			"username": username,
		},
	})
	manager.BroadcastToUser(username, replyMsg, "")
}

// BroadcastDataUpdated REST API 保存数据后通过 WebSocket 广播
func BroadcastDataUpdated(manager *WSManager, username string, version int64, changedWidgets []string, deletedWidgets []string, structureChanged bool) {
	if manager == nil {
		return
	}
	payload := map[string]interface{}{
		"username": username,
		"version":  version,
	}
	if len(changedWidgets) > 0 {
		payload["changedWidgets"] = changedWidgets
	}
	if len(deletedWidgets) > 0 {
		payload["deletedWidgets"] = deletedWidgets
	}
	if structureChanged {
		payload["structureChanged"] = true
	}
	replyMsg, _ := json.Marshal(map[string]interface{}{
		"type":    "data_updated",
		"payload": payload,
	})
	manager.BroadcastToUser(username, replyMsg, "")
}

// WSBroadcaster 辅助结构体，让 handlers 能方便调用广播
type WSBroadcaster struct {
	Manager *WSManager
}

func (b *WSBroadcaster) BroadcastMemo(username string, widgetID string, content interface{}) {
	BroadcastMemoUpdated(b.Manager, username, widgetID, content)
}

func (b *WSBroadcaster) BroadcastData(username string, version int64, changedWidgets []string, deletedWidgets []string, structureChanged bool) {
	BroadcastDataUpdated(b.Manager, username, version, changedWidgets, deletedWidgets, structureChanged)
}

func (b *WSBroadcaster) BroadcastTodo(username string, widgetID string, content interface{}) {
	BroadcastTodoUpdated(b.Manager, username, widgetID, content)
}

func (b *WSBroadcaster) BroadcastBookmarks(username string, widgetID string, content interface{}) {
	BroadcastBookmarksUpdated(b.Manager, username, widgetID, content)
}

// BroadcastTodoUpdated REST API 保存 todo 后通过 WebSocket 广播
func BroadcastTodoUpdated(manager *WSManager, username string, widgetID string, content interface{}) {
	if manager == nil {
		return
	}
	replyMsg, _ := json.Marshal(map[string]interface{}{
		"type": "todo_updated",
		"payload": map[string]interface{}{
			"widgetId": widgetID,
			"content":  content,
			"username": username,
		},
	})
	manager.BroadcastToUser(username, replyMsg, "")
}

// BroadcastBookmarksUpdated REST API 保存 bookmarks 后通过 WebSocket 广播
func BroadcastBookmarksUpdated(manager *WSManager, username string, widgetID string, content interface{}) {
	if manager == nil {
		return
	}
	replyMsg, _ := json.Marshal(map[string]interface{}{
		"type": "bookmarks_updated",
		"payload": map[string]interface{}{
			"widgetId": widgetID,
			"content":  content,
			"username": username,
		},
	})
	manager.BroadcastToUser(username, replyMsg, "")
}

// globalBroadcaster 全局广播器（由 main.go 初始化）
var globalBroadcaster *WSBroadcaster

func SetBroadcaster(b *WSBroadcaster) {
	globalBroadcaster = b
}

func GetBroadcaster() *WSBroadcaster {
	return globalBroadcaster
}

// HandleGinError 统一 Gin 错误响应
func HandleGinError(c *gin.Context, status int, msg string, err error) {
	if err != nil {
		log.Printf("ws/gin: %s: %v", msg, err)
	} else {
		log.Printf("ws/gin: %s", msg)
	}
	c.JSON(status, gin.H{"error": msg})
}

// 以下类型保留，供 handlers 中类型断言使用
// GinH 是 gin.H 的别名，避免 handlers 中的引用问题
type GinH = gin.H
