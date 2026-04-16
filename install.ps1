# SETH CLI Windows Kurulum Scripti
# Kullanim: PowerShell'i Yonetici olarak ac, sonra:
# irm https://seth.mustafakemalcingil.site/install.ps1 | iex

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Node.js kontrolu
try {
    $nodeVer = (node --version 2>&1).ToString().TrimStart('v').Split('.')[0]
    if ([int]$nodeVer -lt 18) {
        Write-Host "HATA: Node.js v18+ gerekli. Sizdeki: v$nodeVer" -ForegroundColor Red
        Write-Host "https://nodejs.org adresinden guncelleyin." -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "HATA: Node.js bulunamadi. https://nodejs.org adresinden kurun." -ForegroundColor Red
    exit 1
}

Write-Host "Paket indiriliyor..." -ForegroundColor DarkGray

$TMP = "$env:TEMP\seth_install"
if (Test-Path $TMP) { Remove-Item $TMP -Recurse -Force }
New-Item -ItemType Directory -Path $TMP | Out-Null

$zipPath = "$TMP\seth_bundle.zip"
Invoke-WebRequest -Uri "https://seth.mustafakemalcingil.site/seth-web-son.zip" -OutFile $zipPath

Write-Host "Paket aciliyor..." -ForegroundColor DarkGray
Expand-Archive -Path $zipPath -DestinationPath $TMP -Force

$cliPath = "$TMP\seth-web-son\cli"
if (-not (Test-Path $cliPath)) {
    Write-Host "HATA: CLI klasoru bulunamadi." -ForegroundColor Red
    exit 1
}

Set-Location $cliPath

Write-Host "Bagimliliklar kuruluyor..." -ForegroundColor DarkGray
npm install --omit=dev --silent 2>&1 | Where-Object { $_ -notmatch "^npm warn" } | Out-Null

Write-Host "Sisteme kuruluyor..." -ForegroundColor DarkGray
npm install -g . --silent 2>&1 | Out-Null

Clear-Host

Write-Host ""
Write-Host " ███████╗███████╗████████╗██╗  ██╗" -ForegroundColor Red
Write-Host " ██╔════╝██╔════╝╚══██╔══╝██║  ██║" -ForegroundColor Red
Write-Host " ███████╗█████╗     ██║   ███████║" -ForegroundColor Red
Write-Host " ╚════██║██╔══╝     ██║   ██╔══██║" -ForegroundColor Red
Write-Host " ███████║███████╗   ██║   ██║  ██║" -ForegroundColor Red
Write-Host " ╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═╝" -ForegroundColor Red
Write-Host ""
Write-Host "  HİÇBİR SİSTEM GÜVENLİ DEĞİLDİR" -ForegroundColor DarkRed
Write-Host ""
Write-Host "  SETH BASARIYLA KURULDU!" -ForegroundColor Green
Write-Host "  Yeni bir PowerShell penceresi ac ve yaz: seth" -ForegroundColor Yellow
Write-Host ""
