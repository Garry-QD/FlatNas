# FlatNas 一键部署指南 (Debian)

本文档介绍了如何在 Debian 系统上使用 `deploy.sh` 脚本进行 FlatNas 的一键自动化部署。

## 1. 准备工作

### 系统要求
- **操作系统**: Debian 10/11/12 (推荐最新稳定版)
- **权限**: root 用户或具有 sudo 权限的用户
- **网络**: 能够访问 GitHub 和 npm 镜像源

### 获取脚本
如果您还没有下载本项目，请先克隆仓库或直接下载 `deploy.sh` 脚本。

```bash
git clone https://github.com/Garry-QD/FlatNas.git
cd FlatNas
```

## 2. 使用方法

首先，赋予脚本执行权限：

```bash
chmod +x deploy.sh
```

### 2.1 全新安装 (Install)

执行以下命令进行全自动安装。该过程包括环境检查、依赖安装(Node.js, Nginx)、应用构建、服务配置和反向代理设置。

```bash
sudo ./deploy.sh install
```

**安装流程详情：**
1.  **环境检查**：确认系统为 Debian 且拥有 root 权限。
2.  **安装依赖**：自动安装 `curl`, `git`, `nginx`, 并配置 NodeSource 源安装 Node.js 20+。
3.  **拉取代码**：克隆/更新代码到 `/opt/flatnas`。
4.  **构建应用**：安装 npm 依赖并运行 `npm run build` 编译前端资源。
5.  **配置服务**：创建 systemd 服务 `flatnas.service` 并启动后端。
6.  **配置 Nginx**：自动生成反向代理配置，指向后端 API (3000端口) 和前端静态文件。

安装完成后，您可以通过浏览器访问服务器 IP (端口 80) 使用 FlatNas。

### 2.2 更新应用 (Update)

当仓库有代码更新时，运行以下命令即可自动拉取最新代码、重新构建并重启服务。

```bash
sudo ./deploy.sh update
```

### 2.3 推送到 GitHub (Push)

如果您在服务器上修改了配置文件或代码，并希望推送到 GitHub 仓库（作为备份或版本控制）：

```bash
sudo ./deploy.sh push
```
*注意：此功能需要您预先在服务器上配置好 Git 的 SSH Key 或凭证。*

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
