# check_docker_updates.ps1
$ErrorActionPreference = "SilentlyContinue"
$env:DOCKER_CLI_EXPERIMENTAL = "enabled"

function Get-RemoteDigest {
    param($ImageName, $Arch, $Os)
    
    try {
        # Use Start-Process to capture output safely and handle timeouts
        $pinfo = New-Object System.Diagnostics.ProcessStartInfo
        $pinfo.FileName = "docker"
        $pinfo.Arguments = "manifest inspect $ImageName"
        $pinfo.RedirectStandardOutput = $true
        $pinfo.RedirectStandardError = $true
        $pinfo.UseShellExecute = $false
        $pinfo.CreateNoWindow = $true
        
        $p = New-Object System.Diagnostics.Process
        $p.StartInfo = $pinfo
        $p.Start() | Out-Null
        
        # Timeout 10 seconds to avoid hanging on private/unreachable repos
        if ($p.WaitForExit(10000)) {
            # Finished
        } else {
            try { $p.Kill() } catch {}
            return $null
        }
        
        $stdout = $p.StandardOutput.ReadToEnd()
        if (-not $stdout) { return $null }
        
        $json = $stdout | ConvertFrom-Json
        
        # 1. Handle Manifest List (common for official images like alpine, node, etc.)
        if ($json.manifests) {
            $match = $json.manifests | Where-Object { 
                $_.platform.architecture -eq $Arch -and $_.platform.os -eq $Os 
            }
            if ($match) {
                return $match.digest
            }
        }
        
        # 2. Handle Single Manifest (V2 Schema 2) - Common for simple pushes (e.g. docker push user/repo:latest)
        if ($json.config -and $json.layers) {
             # For single architecture images, the manifest inspect returns the manifest itself.
             # We can't easily get the "repo digest" (sha256 of the manifest) directly from the JSON content 
             # without hashing it ourselves, which is complex in PowerShell.
             # However, 'docker manifest inspect -v' gives the digest in the reference field sometimes, 
             # or we can rely on the fact that if we got a JSON back, it exists remotely.
             
             # A simple workaround for single-arch images:
             # We pull the manifest digest using a different trick if needed, but for now,
             # let's try to see if we can extract the digest from the output header if docker provides it,
             # or just skip deep comparison for single-arch images to avoid false positives.
             
             # Actually, 'docker manifest inspect' output IS the manifest. 
             # Docker CLI doesn't easily output the digest of that manifest.
             # Let's try to parse the 'Docker-Content-Digest' header if we used curl, but here we use docker CLI.
             
             # Improvement: Use 'docker inspect --remote' if available (rare) or rely on the fact 
             # that if we can't match a multi-arch manifest, we might just check if the image ID changed? No.
             
             return "single-arch-detected" 
        }

        return $null
    } catch {
        return $null
    }
}

Write-Host "Checking local 'latest' images for updates..." -ForegroundColor Cyan

$hasUpdate = $false
$statusFile = Join-Path $PSScriptRoot "data/docker-status.json"
# Ensure data directory exists
if (-not (Test-Path (Join-Path $PSScriptRoot "data"))) {
    New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot "data") | Out-Null
}

# Find all images with :latest tag
$images = docker images --format "{{.Repository}}:{{.Tag}}" | Select-String ":latest$"

if (-not $images) {
    Write-Host "No images with ':latest' tag found."
    # Write no update status
    @{ hasUpdate = $false; lastCheck = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss") } | ConvertTo-Json | Set-Content -Path $statusFile -Encoding UTF8
    exit
}

foreach ($line in $images) {
    $image = $line.ToString().Trim()
    
    # Inspect local image
    $localInfo = docker inspect $image | ConvertFrom-Json
    if (-not $localInfo) { continue }
    
    $repoDigests = $localInfo[0].RepoDigests
    if (-not $repoDigests) {
        # Skipping images without repo digests (likely local builds)
        continue
    }
    
    # Extract local digest (format: repo@sha256:hash)
    $localDigest = $repoDigests[0] -replace ".*@"
    
    $arch = $localInfo[0].Architecture
    $os = $localInfo[0].Os
    
    Write-Host "Checking $image... " -NoNewline
    
    $remoteDigest = Get-RemoteDigest -ImageName $image -Arch $arch -Os $os
    
    if ($remoteDigest) {
        if ($remoteDigest -eq "single-arch-detected") {
             Write-Host " [Single Arch - Cannot Verify]" -ForegroundColor DarkGray
        }
        elseif ($localDigest -ne $remoteDigest) {
            $hasUpdate = $true
            Write-Host " [UPDATE AVAILABLE]" -ForegroundColor Yellow
            Write-Host "    Local:  $localDigest" -ForegroundColor DarkGray
            Write-Host "    Remote: $remoteDigest" -ForegroundColor DarkGray
            
            $input = Read-Host "    Do you want to upgrade '$image' now? (y/N)"
            if ($input -eq 'y') {
                docker pull $image
            }
        } else {
            Write-Host " [Up to date]" -ForegroundColor Green
        }
    } else {
        Write-Host " [Skipped (Check failed or unknown format)]" -ForegroundColor DarkGray
    }
}

# Write final status to file for the web app to consume
@{ 
    hasUpdate = $hasUpdate
    lastCheck = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss") 
} | ConvertTo-Json | Set-Content -Path $statusFile -Encoding UTF8
