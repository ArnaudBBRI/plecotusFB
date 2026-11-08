# Tests sans Pester, sans ouverture de Kaleidoscope, compatibles PowerShell 5.1.
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'plecotus-local.ps1') -LibraryOnly
$script:TestCount = 0

function Assert-Equal {
    param($Actual, $Expected, [string]$Description)
    if ($Actual -cne $Expected) { throw "$Description : attendu [$Expected], obtenu [$Actual]." }
    $script:TestCount++
}

function Assert-Throws {
    param([scriptblock]$Action, [string]$Description)
    $thrown = $false
    try { & $Action | Out-Null }
    catch { $thrown = $true }
    if (-not $thrown) { throw "$Description : un rejet était attendu." }
    $script:TestCount++
}

function Parse-TestRequest {
    param([string]$Text)
    $stream = New-Object System.IO.MemoryStream
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Position = 0
    try { return Read-PlecotusRequest -Stream $stream }
    finally { $stream.Dispose() }
}

$testDirectory = Join-Path $PSScriptRoot ('windows-launcher-fixture-' + [Guid]::NewGuid().ToString('N'))
[void][System.IO.Directory]::CreateDirectory($testDirectory)
$exePath = Join-Path $testDirectory 'kaleidoscope.exe'
$wavPath = Join-Path $testDirectory "contact de l'étang & accent é.wav"
[System.IO.File]::WriteAllText($exePath, 'fichier fictif, ne pas executer')
[System.IO.File]::WriteAllText($wavPath, 'fichier fictif')
$chiroNames = @('ChiroSurf.exe', 'CHIROsurf_4.6.exe', 'ChiroSurf4.6.exe', 'ChiroSurf 4.6.1.exe', 'ChiroSurf-4.6.exe')
foreach ($name in $chiroNames) {
    [System.IO.File]::WriteAllText((Join-Path $testDirectory $name), 'fichier fictif, ne pas executer')
}
# Les routes conservent la vraie validation des chemins, mais le lancement natif
# est remplace avant tout test : aucun executable fictif ne peut etre execute.
$originalLauncher = (Get-Item Function:\Start-PlecotusRecording).ScriptBlock
$script:MockLaunchCount = 0
$script:MockViewer = ''
$script:MockStartInfo = $null
function Start-PlecotusRecording {
    param([string]$Executable, [string]$File, [string]$Viewer = 'kaleidoscope', [object[]]$SearchFolders = @())
    $script:MockStartInfo = Get-PlecotusStartInfo -Executable $Executable -File $File -Viewer $Viewer
    $script:MockViewer = $Viewer
    $script:MockLaunchCount++
    return @{ Path = $File; Relocated = $false }
}
try {
    Assert-Equal (Get-PlecotusAbsolutePath $exePath executable) $exePath 'Chemin exe absolu existant'
    Assert-Equal (Get-PlecotusAbsolutePath $wavPath audio) $wavPath 'Chemin WAV avec espaces et accent'
    Assert-Equal (Get-PlecotusAbsolutePath ($wavPath.Replace('\', '/')) audio) $wavPath 'Separateurs Windows normalises'
    Assert-Equal (Get-PlecotusWavArgument $wavPath) ('"' + $wavPath + '"') 'Un seul argument WAV entre guillemets'
    foreach ($name in $chiroNames) {
        $chiroPath = Join-Path $testDirectory $name
        Assert-Equal (Get-PlecotusAbsolutePath $chiroPath executable chirosurf) $chiroPath "Executable ChiroSurf autorise : $name"
    }
    foreach ($name in @('cmd.exe', 'ChiroSurf-cli.exe', 'ChiroSurf_.exe', 'ChiroSurf..exe', 'ChiroSurf_4..6.exe',
        'ChiroSurf__4.6.exe', 'ChiroSurf_4.6beta.exe', 'ChiroSurf_4.6.exe.cmd', 'ChiroSurf_4.6 .exe')) {
        Assert-Throws { Get-PlecotusAbsolutePath (Join-Path $testDirectory $name) executable chirosurf } "Executable ChiroSurf refuse : $name"
    }
    Assert-Throws { Get-PlecotusAbsolutePath $exePath executable chirosurf } 'Kaleidoscope refuse pour ChiroSurf'
    Assert-Throws { Get-PlecotusAbsolutePath (Join-Path $testDirectory 'ChiroSurf.exe') executable } 'ChiroSurf refuse pour Kaleidoscope par defaut'
    Assert-Throws { Get-PlecotusAbsolutePath $exePath executable autre } 'Logiciel inconnu refuse'
    $startInfo = Get-PlecotusStartInfo -Executable $exePath -File $wavPath
    Assert-Equal $startInfo.FileName $exePath 'Programme Kaleidoscope par defaut'
    Assert-Equal $startInfo.Arguments ('"' + $wavPath + '"') 'Argument unique avec espaces, accents et esperluette'
    Assert-Equal $startInfo.UseShellExecute $false 'Aucun shell pour ouvrir le WAV'
    Assert-Equal $startInfo.WorkingDirectory $testDirectory 'Dossier de travail du logiciel'
    Assert-Equal $startInfo.WindowStyle ([System.Diagnostics.ProcessWindowStyle]::Normal) 'Fenetre du logiciel visible'
    $startInfo = Get-PlecotusStartInfo -Executable (Join-Path $testDirectory 'ChiroSurf_4.6.exe') -File $wavPath -Viewer chirosurf
    Assert-Equal $startInfo.FileName (Join-Path $testDirectory 'ChiroSurf_4.6.exe') 'Programme ChiroSurf configure'
    Assert-Equal $startInfo.Arguments ('"' + $wavPath + '"') 'ChiroSurf recoit un seul WAV entre guillemets'
    Assert-Equal $startInfo.UseShellExecute $false 'ChiroSurf ne passe pas par un shell'
    foreach ($path in @('contact.wav', '.\contact.wav', 'C:contact.wav', '\contact.wav',
        'https://example.org/contact.wav', 'file:///C:/contact.wav',
        '\\?\C:\contact.wav', '\\.\C:\contact.wav', 'C:\NUL.wav',
        'C:\contact.wav:flux', 'C:\contact".wav', "C:\contact`n.wav", "C:\contact`0.wav", 'C:\*.wav')) {
        Assert-Throws { Get-PlecotusAbsolutePath $path audio } "Chemin refuse : $path"
    }
    Assert-Throws { Get-PlecotusAbsolutePath (Join-Path $testDirectory 'cmd.exe') executable } 'Executables differents refuses'
    Assert-Throws { Get-PlecotusAbsolutePath (Join-Path $testDirectory 'kaleidoscope-cli.exe') executable } 'CLI batch refusee'
    Assert-Throws { Get-PlecotusAbsolutePath $exePath audio } 'Audio non WAV refuse'
    Assert-Throws { Get-PlecotusAbsolutePath (Join-Path $testDirectory 'absent.wav') audio } 'WAV absent refuse'
    Assert-Throws { Get-PlecotusAbsolutePath '\\serveur-inexistant-plecotus\partage\contact.wav' audio } 'Partage absent refuse'

    $request = Parse-TestRequest "GET /api/status HTTP/1.1`r`nHost: 127.0.0.1:4174`r`n`r`n"
    Assert-Equal $request.Target '/api/status' 'Route HTTP lue'
    $status = (Invoke-PlecotusRequest $request).Body | ConvertFrom-Json
    Assert-Equal $status.app 'plecotus-local' 'Marqueur de compagnon'
    Assert-Equal $status.launchAvailable $true 'Etat disponible'
    Assert-Equal $status.version 2 'Version du compagnon avec recherche des WAV'
    Assert-Equal $status.wavSearch $true 'Recherche des WAV declaree'
    Assert-Equal ($status.supportedViewers -join ',') 'kaleidoscope,chirosurf' 'Logiciels declares par le compagnon'
    $request.Headers.host = 'malicious.example:4174'
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 403 'Protection Host / DNS rebinding'
    Assert-Throws { Parse-TestRequest "GET / HTTP/1.1`r`nHost: 127.0.0.1:4174`r`nHost: example.org`r`n`r`n" } 'En-tetes doubles refuses'
    Assert-Throws { Parse-TestRequest "POST /api/kaleidoscope HTTP/1.1`r`nHost: 127.0.0.1:4174`r`nTransfer-Encoding: chunked`r`n`r`n" } 'Transfer-Encoding refuse'
    Assert-Throws { Parse-TestRequest "POST /api/kaleidoscope HTTP/1.1`r`nHost: 127.0.0.1:4174`r`nContent-Length: 32769`r`n`r`n" } 'Corps borne'
    Assert-Throws { Parse-TestRequest "POST /api/kaleidoscope HTTP/1.1`r`nHost: 127.0.0.1:4174`r`nContent-Length: -1`r`n`r`n" } 'Longueur negative refusee'
    Assert-Throws { Parse-TestRequest "POST /api/kaleidoscope HTTP/1.1`r`nHost: 127.0.0.1:4174`r`nContent-Length: 5`r`n`r`n{}" } 'Corps incomplet refuse'
    Assert-Throws { Parse-TestRequest ('GET / HTTP/1.1' + "`r`nX-Long: " + ('a' * 16384)) } 'En-tetes bornes'

    $script:PlecotusToken = 'jeton-fictif'
    $request = @{ Method = 'POST'; Target = '/api/kaleidoscope'; Body = '{}'; Headers = @{ host = '127.0.0.1:4174'; 'content-type' = 'application/json' } }
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 403 'Absence Origin / jeton refusee'
    $request.Headers.origin = 'http://127.0.0.1:4174'
    $request.Headers['x-plecotus-token'] = 'mauvais-jeton'
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 403 'Mauvais jeton refuse'
    $request.Headers['x-plecotus-token'] = $script:PlecotusToken
    $request.Headers.origin = 'http://example.org'
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 403 'Autre Origin refusee'
    $request.Headers.origin = 'http://127.0.0.1:4174'
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 422 'Champs JSON obligatoires'
    $request.Body = '{invalid'
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 422 'JSON invalide refuse'
    $request.Body = '{"executable":"cmd.exe","file":"contact.wav"}'
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 422 'Commande arbitraire refusee sans lancement'
    $request.Body = @{ executable = $exePath; file = $wavPath } | ConvertTo-Json -Compress
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 200 'Route historique Kaleidoscope toujours acceptee'
    Assert-Equal $script:MockViewer 'kaleidoscope' 'Route historique cible Kaleidoscope'
    $request.Body = @{ viewer = 'chirosurf'; executable = (Join-Path $testDirectory 'ChiroSurf.exe'); file = $wavPath } | ConvertTo-Json -Compress
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 422 'Route historique ne permet pas de choisir ChiroSurf'
    $request.Body = @{ executable = (Join-Path $testDirectory 'ChiroSurf.exe'); file = $wavPath } | ConvertTo-Json -Compress
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 422 'Route historique refuse executable ChiroSurf sans viewer'
    $request.Target = '/api/open-recording'
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 422 'Nouvelle route exige viewer explicite'
    foreach ($viewer in @('', 'autre', 'Kaleidoscope', $true, 123, @('chirosurf'))) {
        $request.Body = @{ viewer = $viewer; executable = $exePath; file = $wavPath } | ConvertTo-Json -Compress
        Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 422 'Viewer inconnu ou non chaine refuse'
    }
    $request.Body = @{ viewer = 'kaleidoscope'; executable = $exePath; file = $wavPath } | ConvertTo-Json -Compress
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 200 'Nouvelle route accepte Kaleidoscope'
    Assert-Equal $script:MockViewer 'kaleidoscope' 'Nouvelle route transmet Kaleidoscope'
    $request.Body = @{ viewer = 'chirosurf'; executable = (Join-Path $testDirectory 'ChiroSurf_4.6.exe'); file = $wavPath } | ConvertTo-Json -Compress
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 200 'Nouvelle route accepte ChiroSurf avec version'
    Assert-Equal $script:MockViewer 'chirosurf' 'Nouvelle route transmet ChiroSurf'
    Assert-Equal $script:MockStartInfo.FileName (Join-Path $testDirectory 'ChiroSurf_4.6.exe') 'Route ChiroSurf valide le bon executable'
    Assert-Equal $script:MockStartInfo.Arguments ('"' + $wavPath + '"') 'Route ChiroSurf conserve le WAV en un argument'
    Assert-Equal $script:MockLaunchCount 3 'Seules les trois demandes valides atteignent le lancement simule'
    foreach ($viewer in @('kaleidoscope', 'chirosurf')) {
        $wrongExecutable = if ($viewer -eq 'kaleidoscope') { Join-Path $testDirectory 'ChiroSurf.exe' } else { $exePath }
        $request.Body = @{ viewer = $viewer; executable = $wrongExecutable; file = $wavPath } | ConvertTo-Json -Compress
        Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 422 'Executable incompatible avec le logiciel refuse'
    }
    $request.Body = @{ viewer = 'chirosurf'; executable = 'C:\Windows\System32\cmd.exe'; file = $wavPath } | ConvertTo-Json -Compress
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 422 'Nouvelle route refuse executable arbitraire'
    $request.Body = @{ viewer = 'chirosurf'; executable = (Join-Path $testDirectory 'ChiroSurf.exe'); file = $exePath } | ConvertTo-Json -Compress
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 422 'Nouvelle route refuse fichier non WAV'
    $request.Method = 'GET'
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 405 'Nouvelle route exige POST'
    $request.Method = 'POST'
    $request.Headers.host = 'malicious.example:4174'
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 403 'Nouvelle route exige Host local'
    $request.Headers.host = '127.0.0.1:4174'
    $request.Headers.origin = 'null'
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 403 'Nouvelle route exige Origin local'
    $request.Headers.origin = 'http://127.0.0.1:4174'
    $request.Headers['x-plecotus-token'] = 'autre'
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 403 'Nouvelle route exige jeton courant'
    $request.Headers['x-plecotus-token'] = $script:PlecotusToken
    $request.Headers['content-type'] = 'text/plain'
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 415 'Content-Type verifie'
    $request.Target = '/api/stop'
    Assert-Equal (Invoke-PlecotusRequest $request).Stop $true 'Arret authentifie'
    $request.Headers['x-plecotus-token'] = 'autre'
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 403 'Arret protege par jeton'

    $request = @{ Method = 'GET'; Target = '/Plecotus.html'; Body = ''; Headers = @{ host = '127.0.0.1:4174' } }
    $htmlResult = Invoke-PlecotusRequest $request
    Assert-Equal $htmlResult.StatusCode 200 'HTML autonome servi'
    Assert-Equal ($htmlResult.Body.Contains('<meta name="plecotus-local-token" content="jeton-fictif">')) $true 'Jeton injecte'
    $request.Target = '/METHODS.md'
    $methodsResult = Invoke-PlecotusRequest $request
    Assert-Equal $methodsResult.StatusCode 200 'Guide local accessible'
    Assert-Equal $methodsResult.ContentType 'text/plain; charset=utf-8' 'Guide Markdown servi comme texte'
    $request.Target = '/app.js'
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 404 'Autres fichiers non exposes'
    $request.Target = '/../README.md'
    Assert-Equal (Invoke-PlecotusRequest $request).StatusCode 404 'Parcours des dossiers refuse'
    $stream = New-Object System.IO.MemoryStream
    try {
        Write-PlecotusResponse -Stream $stream -Result (New-PlecotusResult -Data @{ ok = $true })
        $response = [System.Text.Encoding]::UTF8.GetString($stream.ToArray())
        Assert-Equal ($response.Contains("X-Frame-Options: DENY`r`n")) $true 'Protection contre les frames'
        Assert-Equal ($response.Contains("X-Content-Type-Options: nosniff`r`n")) $true 'Protection MIME'
        Assert-Equal ($response.Contains('Access-Control-Allow-Origin')) $false 'Pas de CORS permissif'
    }
    finally { $stream.Dispose() }
    Write-Output "$script:TestCount tests du compagnon Windows réussis ; aucun lancement natif."
}
finally {
    Set-Item Function:\Start-PlecotusRecording $originalLauncher
    [System.IO.File]::Delete($wavPath)
    [System.IO.File]::Delete($exePath)
    foreach ($name in $chiroNames) { [System.IO.File]::Delete((Join-Path $testDirectory $name)) }
    [System.IO.Directory]::Delete($testDirectory)
}
