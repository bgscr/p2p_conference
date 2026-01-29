Get-ChildItem -Path src/__tests__ -Include *.test.tsx,*.test.ts -Recurse | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    if ($null -ne $content -and !$content.Contains('@vitest-environment')) {
        $newContent = "/**`n * @vitest-environment jsdom`n */`n" + $content
        Set-Content $_.FullName $newContent -Encoding UTF8
        Write-Output "Updated $($_.Name)"
    }
}
