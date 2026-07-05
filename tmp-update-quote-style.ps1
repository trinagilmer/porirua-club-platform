$path = "backend/views/pages/functions/quote.ejs"
$content = Get-Content -Path $path -Raw
$insert = @"
  .proposal-builder-wrapper { background: #f0f4f9 !important; border-color: #d1dde9 !important; }
  .proposal-builder-wrapper .proposal-builder-toggle { background: #e8eef8; padding: 1rem; border-radius: 0.9rem 0.9rem 0 0; border-bottom: 1px solid #d1dde9; }
"@
if ($content.Contains('.proposal-builder-wrapper { background: #f0f4f9 !important; border-color: #d1dde9 !important; }')) {
  Write-Host "Styles already present"
  exit 0
}
$updated = $content -replace "</style>", "$insert`r`n</style>"
if ($updated -eq $content) {
  Write-Host "No style tag found"
  exit 1
}
[System.IO.File]::WriteAllText((Resolve-Path $path), $updated, [System.Text.UTF8Encoding]::new($false))
Write-Host "Updated styles in $path"
