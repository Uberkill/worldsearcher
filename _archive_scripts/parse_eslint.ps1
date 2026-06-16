$json = Get-Content eslint_output.json -Raw | ConvertFrom-Json
$json | Where-Object { $_.errorCount -gt 0 } | ForEach-Object {
    $fp = $_.filePath.Split('\')[-1]
    $_.messages | Where-Object { $_.ruleId -eq 'no-unused-vars' } | ForEach-Object {
        "$fp : L$($_.line) - $($_.message)"
    }
}
