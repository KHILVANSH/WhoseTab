<#
.SYNOPSIS
    Securely configures or updates your GitHub Personal Access Token (PAT) for the WhoseTab private repository.
.DESCRIPTION
    Prompts for a GitHub Personal Access Token (PAT), sets git credential helper or authenticates remote URL,
    and tests repository access.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$Token,

    [string]$Username = "KHILVANSH",
    [string]$Repo = "WhoseTab"
)

$GitPath = "C:\Program Files\Git\cmd\git.exe"
if (Test-Path $GitPath) {
    $env:Path += ";C:\Program Files\Git\cmd"
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       WhoseTab — GitHub PAT Credentials Helper          " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

if (-not $Token) {
    Write-Host "Enter your GitHub Personal Access Token (PAT) with 'repo' scope:" -ForegroundColor Yellow
    $Token = Read-Host -Prompt "PAT (ghp_... or github_pat_...)" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Token)
    $Token = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
}

if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Error "Token cannot be empty. Aborted."
    exit 1
}

# Configure remote URL with PAT
$AuthenticatedUrl = "https://$($Username):$($Token)@github.com/$Username/$Repo.git"

Write-Host "Setting git remote origin..." -ForegroundColor Green
& git remote set-url origin $AuthenticatedUrl 2>$null
if ($LASTEXITCODE -ne 0) {
    & git remote add origin $AuthenticatedUrl
}

Write-Host "Testing connection with GitHub..." -ForegroundColor Yellow
$TestResult = & git ls-remote origin 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✓ Successfully authenticated with private repository $Username/$Repo!" -ForegroundColor Green
    Write-Host "You can now run 'git push origin main' or 'git pull' seamlessly." -ForegroundColor Green
} else {
    Write-Host "`n✗ Authentication failed: $TestResult" -ForegroundColor Red
    Write-Host "Please check that your PAT has 'repo' scope and hasn't expired." -ForegroundColor Red
}
