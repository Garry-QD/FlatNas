# FlatNas 一键部署指南 (Debian)

本文档介绍了如何在 Debian 系统上使用 `deploy.sh` 脚本进行 FlatNas 的一键自动化部署。

## 1. 准备工作

### 系统要求
- **操作系统**: Debian 10/11/12 (推荐最新稳定版)
- **权限**: root 用户或具有 sudo 权限的用户
- **网络**: 能够访问 GitHub 和 npm 镜像源

### 获取脚本与快速安装

**方式一：快速安装命令（推荐）**
无需手动下载代码，直接复制以下命令执行即可：

```bash
wget -O deploy.sh https://raw.githubusercontent.com/Garry-QD/FlatNas/main/deploy.sh && sudo bash deploy.sh install
```

**方式二：手动克隆仓库**
如果您希望手动管理代码：

```bash
git clone https://github.com/Garry-QD/FlatNas.git
cd FlatNas
chmod +x deploy.sh
sudo ./deploy.sh install
```

## 2. 使用方法

### 2.1 交互式菜单 (推荐)

直接运行脚本而不带任何参数，将进入交互式菜单，方便您选择安装或卸载：

```bash
sudo ./deploy.sh
```

```text
=============================================
      FlatNas One-Click Deployment           
=============================================
1. Install / Redeploy FlatNas
2. Uninstall FlatNas
3. Update FlatNas (Keep Data)
4. Push to GitHub
0. Exit
=============================================
```

### 2.2 命令行模式

您也可以通过参数直接执行特定操作：

*   **安装**: `sudo ./deploy.sh install`
*   **卸载**: `sudo ./deploy.sh uninstall`
*   **更新**: `sudo ./deploy.sh update`
*   **推送**: `sudo ./deploy.sh push`

### 2.3 卸载说明 (Uninstall)

选择卸载功能时，脚本会执行以下操作：
1.  停止并禁用 systemd 服务。
2.  移除 Nginx 配置文件并重载 Nginx。
3.  **询问用户**是否删除应用程序目录（包含数据）。
    *   输入 `y`：彻底删除所有文件（包括 `data.json`）。
    *   输入 `n`：保留数据文件，以便后续重装。

## 3. 目录结构说明

- **应用根目录**: `/opt/flatnas`
- **配置文件**: `/opt/flatnas/server/data/data.json`
- **Nginx 配置**: `/etc/nginx/sites-available/flatnas`
- **日志文件**: 通过 `journalctl -u flatnas` 查看后端日志

## 4. 常见问题

**Q: 安装 Nginx 失败？**
A: 请检查是否有其他 Web 服务占用 80 端口 (如 Apache)，脚本会自动尝试停用默认 Nginx 站点，但不会处理冲突的端口占用。

**Q: 部署后无法访问？**
A: 
1. 检查防火墙设置，确保 80 端口开放 (`ufw allow 80`).
2. 检查服务状态: `systemctl status flatnas` 和 `systemctl status nginx`.

**Q: 如何查看运行日志？**
A: 使用 `journalctl -u flatnas -f` 实时查看后端输出。
