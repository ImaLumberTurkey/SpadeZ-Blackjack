$nodeBin = 'C:\Users\jacks\AppData\Local\nodejs\node-v24.19.0-win-x64'
$env:PATH = "$nodeBin;$env:PATH"
$npmCmd = Join-Path $nodeBin 'npm.cmd'
Set-Location 'C:\Users\jacks\Documents\SpadeZ-Blackjack'
& $npmCmd run lint
