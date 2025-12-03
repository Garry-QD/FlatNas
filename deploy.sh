#!/bin/bash

# FlatNas One-Click Deployment Script for Debian
# Author: Trae AI Assistant
# Description: Automated deployment of FlatNas on Debian systems with Nginx and Systemd.

set -e

# Configuration
APP_DIR="/opt/flatnas"
REPO_URL="https://github.com/Garry-QD/FlatNas.git"
NODE_MAJOR=20
SERVICE_NAME="flatnas"
NGINX_CONF="/etc/nginx/sites-available/flatnas"
CURRENT_USER=$(whoami)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Log function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
    exit 1
}

warn() {
    echo -e "${YELLOW}[WARN] $1${NC}"
}

# 1. System Environment Check
check_system() {
    log "Checking system environment..."
    if [ "$EUID" -ne 0 ]; then
        error "Please run as root (sudo ./deploy.sh)"
    fi

    if [ ! -f /etc/debian_version ]; then
        error "This script is designed for Debian systems only."
    fi
    
    log "System check passed: Debian detected."
}

# 2. Install Dependencies
install_dependencies() {
    log "Updating system and installing dependencies..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq curl git gnupg2 ca-certificates lsb-release

    # Install Node.js
    if ! command -v node &> /dev/null; then
        log "Installing Node.js ${NODE_MAJOR}..."
        mkdir -p /etc/apt/keyrings
        curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
        echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
        apt-get update -qq
        apt-get install -y -qq nodejs
    else
        log "Node.js is already installed: $(node -v)"
    fi

    # Install Nginx
    if ! command -v nginx &> /dev/null; then
        log "Installing Nginx..."
        apt-get install -y -qq nginx
    else
        log "Nginx is already installed."
    fi
    
    # Enable Nginx
    systemctl enable nginx
    systemctl start nginx
}

# 3. Deploy Application
deploy_app() {
    log "Deploying application to ${APP_DIR}..."

    # Create directory if not exists
    if [ ! -d "$APP_DIR" ]; then
        log "Cloning repository..."
        git clone "$REPO_URL" "$APP_DIR"
    else
        log "Directory exists. Pulling latest changes..."
        cd "$APP_DIR"
        # Stash local changes to config files if any, to avoid conflict
        git stash
        git pull
        git stash pop || true
    fi

    cd "$APP_DIR"

    # Install project dependencies
    log "Installing npm dependencies..."
    npm install

    # Build Frontend
    log "Building frontend..."
    npm run build

    # Prepare backend directories
    log "Preparing backend directories..."
    mkdir -p server/data server/music
}

# 4. Configure Systemd Service
setup_service() {
    log "Configuring Systemd service..."
    
    cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=FlatNas Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}
ExecStart=$(which node) server/server.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable ${SERVICE_NAME}
    log "Restarting application service..."
    systemctl restart ${SERVICE_NAME}
}

# 5. Configure Nginx
setup_nginx() {
    log "Configuring Nginx..."

    cat > ${NGINX_CONF} <<EOF
server {
    listen 80;
    server_name _;

    root ${APP_DIR}/dist;
    index index.html;

    # Frontend
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
    
    # Music
    location /music/ {
        proxy_pass http://localhost:3000/music/;
        proxy_set_header Host \$host;
    }
    
    # CGI
    location ~ \.cgi$ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host \$host;
    }
}
EOF

    # Enable site
    if [ ! -L /etc/nginx/sites-enabled/flatnas ]; then
        ln -s ${NGINX_CONF} /etc/nginx/sites-enabled/
    fi

    # Disable default if exists
    if [ -f /etc/nginx/sites-enabled/default ]; then
        rm /etc/nginx/sites-enabled/default
    fi

    # Test and Reload
    nginx -t
    systemctl reload nginx
}

# 6. GitHub Integration (Push functionality)
push_to_github() {
    cd "$APP_DIR"
    log "Pushing changes to GitHub..."
    
    # Check if user has configured git
    if [ -z "$(git config --global user.email)" ]; then
        warn "Git user not configured. Please configure git user.email and user.name manually."
        return
    fi

    git add .
    echo "Enter commit message: "
    read commit_msg
    if [ -z "$commit_msg" ]; then
        commit_msg="Auto update from deploy script"
    fi
    
    git commit -m "$commit_msg"
    
    # This requires SSH key or credential helper to be set up on the server
    git push origin main
}

# 7. Uninstall FlatNas
uninstall_app() {
    log "Uninstalling FlatNas..."

    # 1. Stop and Remove Service
    if systemctl list-units --full -all | grep -Fq "${SERVICE_NAME}.service"; then
        log "Stopping and disabling service..."
        systemctl stop ${SERVICE_NAME}
        systemctl disable ${SERVICE_NAME}
        rm -f /etc/systemd/system/${SERVICE_NAME}.service
        systemctl daemon-reload
    else
        warn "Service ${SERVICE_NAME} not found."
    fi

    # 2. Remove Nginx Config
    if [ -f "${NGINX_CONF}" ]; then
        log "Removing Nginx configuration..."
        rm -f ${NGINX_CONF}
        rm -f /etc/nginx/sites-enabled/flatnas
        nginx -t
        systemctl reload nginx
    else
        warn "Nginx configuration not found."
    fi

    # 3. Remove Files
    if [ -d "$APP_DIR" ]; then
        echo -e "${YELLOW}Warning: This will delete the application directory.${NC}"
        read -p "Do you want to delete ALL DATA in $APP_DIR? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            log "Removing application files..."
            rm -rf "$APP_DIR"
            log "FlatNas has been completely removed."
        else
            log "Application files kept at $APP_DIR."
            log "FlatNas service and nginx config have been removed."
        fi
    else
        log "Application directory not found."
    fi
}

# Main Menu
show_help() {
    echo "Usage: ./deploy.sh [OPTION]"
    echo "Options:"
    echo "  install    - Full installation and deployment"
    echo "  uninstall  - Remove FlatNas service and files"
    echo "  update     - Pull latest code and rebuild"
    echo "  push       - Commit and push local changes to GitHub"
    echo "  help       - Show this help message"
}

# Function to handle installation logic
do_install() {
    check_system
    install_dependencies
    deploy_app
    setup_service
    setup_nginx
    
    IP_ADDR=$(hostname -I | awk '{print $1}')
    PUBLIC_IP=$(curl -s ifconfig.me || echo "Unknown")
    
    log "==============================================="
    log "   FlatNas Deployment Successful!   "
    log "==============================================="
    log "Access your FlatNas at:"
    log "  Local:   http://${IP_ADDR}"
    log "  Public:  http://${PUBLIC_IP}"
    log "==============================================="
}

if [ -n "$1" ]; then
    case "$1" in
        install)
            do_install
            ;;
        update)
            check_system
            deploy_app
            setup_service
            log "Update Complete!"
            ;;
        push)
            push_to_github
            ;;
        uninstall)
            check_system
            uninstall_app
            ;;
        *)
            show_help
            ;;
    esac
else
    # Interactive Menu
    clear
    echo -e "${GREEN}=============================================${NC}"
    echo -e "${GREEN}      FlatNas One-Click Deployment           ${NC}"
    echo -e "${GREEN}=============================================${NC}"
    echo "1. Install / Redeploy FlatNas"
    echo "2. Uninstall FlatNas"
    echo "3. Update FlatNas (Keep Data)"
    echo "4. Push to GitHub"
    echo "0. Exit"
    echo -e "${GREEN}=============================================${NC}"
    read -p "Please enter your choice [0-4]: " choice
    
    case $choice in
        1)
            do_install
            ;;
        2)
            check_system
            uninstall_app
            ;;
        3)
            check_system
            deploy_app
            setup_service
            log "Update Complete!"
            ;;
        4)
            push_to_github
            ;;
        0)
            exit 0
            ;;
        *)
            error "Invalid choice."
            ;;
    esac
fi
