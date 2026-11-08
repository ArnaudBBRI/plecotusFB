[CmdletBinding()]
param(
    [switch]$LibraryOnly,
    [switch]$NoBrowser
)

# Windows PowerShell 5.1, sans installation ni droit administrateur.
# Le serveur n'ecoute que sur 127.0.0.1. Aucun fichier audio n'est modifie.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$script:PlecotusPort = 4174
$script:PlecotusOrigin = 'http://127.0.0.1:4174'
$script:PlecotusDirectory = $PSScriptRoot
$script:PlecotusToken = ''
# Recherche des WAV deplaces : index nom de fichier -> chemins, par dossier de recherche.
$script:PlecotusSearchIndexes = @{}
$script:PlecotusIndexMaxAgeSeconds = 300
$script:PlecotusIndexRetrySeconds = 30
$script:PlecotusMaxSearchFolders = 20
$script:PlecotusMaxSearchDepth = 40

function Get-PlecotusAbsolutePath {
    param(
        [string]$Path,
        [ValidateSet('executable', 'audio', 'folder')][string]$Kind,
        [ValidateSet('kaleidoscope', 'chirosurf')][string]$Viewer = 'kaleidoscope',
        [switch]$AllowMissing
    )

    $viewerName = if ($Viewer -eq 'chirosurf') { 'ChiroSurf' } else { 'Kaleidoscope' }
    $description = if ($Kind -eq 'executable') { $viewerName } elseif ($Kind -eq 'folder') { 'du dossier de recherche' } else { 'du fichier WAV' }
    if ([string]::IsNullOrWhiteSpace($Path) -or $Path -match '[\x00-\x1F\x7F"<>|?*]') {
        throw "Le chemin $description est vide ou contient des caractères interdits."
    }
    $candidate = $Path.Replace('/', '\')
    if ($candidate -match '^\\\\[?.]\\' -or
        $candidate -notmatch '^(?:[A-Za-z]:\\|\\\\[^\\:]+\\[^\\:]+\\)') {
        throw "Indiquez un chemin Windows complet $description (lecteur ou partage réseau)."
    }
    $withoutDrive = if ($candidate -match '^[A-Za-z]:\\') { $candidate.Substring(2) } else { $candidate }
    if ($withoutDrive.Contains(':') -or
        $candidate -match '(?i)(^|\\)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|\\|$)') {
        throw "Le chemin $description ne peut pas désigner un périphérique ou un flux Windows."
    }
    try { $fullPath = [System.IO.Path]::GetFullPath($candidate) }
    catch { throw "Le chemin $description n'est pas un chemin Windows valide." }
    if ($Kind -eq 'executable') {
        $fileName = [System.IO.Path]::GetFileName($fullPath)
        if ($Viewer -eq 'kaleidoscope' -and $fileName -ine 'kaleidoscope.exe') {
            throw "Choisissez l'application kaleidoscope.exe ; les autres exécutables ne sont pas autorisés."
        }
        if ($Viewer -eq 'chirosurf' -and $fileName -notmatch '(?i)^ChiroSurf(?:[ _-]?[0-9]+(?:\.[0-9]+)*)?\.exe$') {
            throw "Choisissez l'application ChiroSurf.exe (éventuellement suivie d'une version, comme ChiroSurf_4.6.exe) ; les autres exécutables ne sont pas autorisés."
        }
    }
    if ($Kind -eq 'audio' -and [System.IO.Path]::GetExtension($fullPath) -ine '.wav') {
        throw 'Choisissez un fichier audio dont le nom se termine par .wav.'
    }
    if ($Kind -eq 'folder') {
        if (-not $AllowMissing -and -not [System.IO.Directory]::Exists($fullPath)) {
            throw "Le dossier de recherche est introuvable : $fullPath"
        }
        return $fullPath
    }
    if (-not $AllowMissing -and -not [System.IO.File]::Exists($fullPath)) {
        throw "Le fichier $description est introuvable : $fullPath"
    }
    return $fullPath
}

function New-PlecotusSearchIndex {
    param([string]$Root)
    # Parcourt le dossier et ses sous-dossiers ; les dossiers illisibles sont ignores.
    # Les jonctions et liens symboliques sont ignores (boucles et doublons artificiels),
    # mais les dossiers OneDrive « a la demande » sont parcourus.
    $map = New-Object 'System.Collections.Generic.Dictionary[string,System.Collections.Generic.List[string]]' ([System.StringComparer]::OrdinalIgnoreCase)
    $pending = New-Object 'System.Collections.Generic.Stack[object]'
    $pending.Push(@($Root, 0))
    while ($pending.Count -gt 0) {
        $item = $pending.Pop()
        $directory = [string]$item[0]
        $depth = [int]$item[1]
        $files = @()
        try { $files = [System.IO.Directory]::GetFiles($directory, '*.wav') } catch { $files = @() }
        foreach ($path in $files) {
            # Le motif *.wav de .NET accepte aussi des extensions plus longues (.wave, .wavx).
            if ([System.IO.Path]::GetExtension($path) -ine '.wav') { continue }
            $name = [System.IO.Path]::GetFileName($path)
            $list = $null
            if (-not $map.TryGetValue($name, [ref]$list)) {
                $list = New-Object 'System.Collections.Generic.List[string]'
                $map[$name] = $list
            }
            $list.Add($path)
        }
        if ($depth -ge $script:PlecotusMaxSearchDepth) { continue }
        $children = @()
        try { $children = [System.IO.Directory]::GetDirectories($directory) } catch { $children = @() }
        foreach ($child in $children) {
            try { $attributes = [System.IO.File]::GetAttributes($child) } catch { continue }
            if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                $linkType = $null
                try { $linkType = (Get-Item -LiteralPath $child -Force -ErrorAction Stop).LinkType } catch { $linkType = $null }
                if ($linkType -in @('Junction', 'SymbolicLink')) { continue }
            }
            $pending.Push(@($child, ($depth + 1)))
        }
    }
    return @{ Built = [DateTime]::UtcNow; Map = $map }
}

function Get-PlecotusSearchIndex {
    param([string]$Root, [switch]$Refresh)
    $entry = $script:PlecotusSearchIndexes[$Root]
    if ($Refresh -or $null -eq $entry -or
        ([DateTime]::UtcNow - $entry.Built).TotalSeconds -gt $script:PlecotusIndexMaxAgeSeconds) {
        $entry = New-PlecotusSearchIndex -Root $Root
        $script:PlecotusSearchIndexes[$Root] = $entry
    }
    return $entry
}

function Get-PlecotusSearchCandidates {
    param([string]$Name, [string[]]$Roots, [switch]$RefreshStale)
    $found = New-Object System.Collections.Generic.List[string]
    $stale = $false
    foreach ($root in $Roots) {
        $refresh = $false
        if ($RefreshStale) {
            $entry = $script:PlecotusSearchIndexes[$root]
            $refresh = $null -ne $entry -and ([DateTime]::UtcNow - $entry.Built).TotalSeconds -gt $script:PlecotusIndexRetrySeconds
        }
        $index = Get-PlecotusSearchIndex -Root $root -Refresh:$refresh
        $paths = $null
        if (-not $index.Map.TryGetValue($Name, [ref]$paths)) { continue }
        foreach ($path in $paths) {
            if (-not [System.IO.File]::Exists($path)) { $stale = $true; continue }
            # Deux dossiers de recherche imbriques peuvent livrer le meme fichier.
            if (-not ($found -contains $path)) { $found.Add($path) }
        }
    }
    return @{ Paths = $found; Stale = $stale }
}

function Find-PlecotusRecording {
    param([string]$File, [object[]]$SearchFolders = @())
    $wavPath = Get-PlecotusAbsolutePath -Path $File -Kind audio -AllowMissing
    if ([System.IO.File]::Exists($wavPath)) { return @{ Path = $wavPath; Relocated = $false } }

    $roots = New-Object System.Collections.Generic.List[string]
    $unavailable = New-Object System.Collections.Generic.List[string]
    foreach ($folder in @($SearchFolders)) {
        $folderPath = Get-PlecotusAbsolutePath -Path ([string]$folder) -Kind folder -AllowMissing
        if (-not [System.IO.Directory]::Exists($folderPath)) {
            if (-not ($unavailable -contains $folderPath)) { $unavailable.Add($folderPath) }
            continue
        }
        if (-not ($roots -contains $folderPath)) { $roots.Add($folderPath) }
    }
    $missing = "Le fichier WAV est introuvable à l'emplacement indiqué dans le fichier id : $wavPath."
    $unavailableText = if ($unavailable.Count) { "`nDossiers de recherche inaccessibles (disque débranché ?) : " + ($unavailable -join ' ; ') } else { '' }
    if ($roots.Count -eq 0) {
        if ($unavailable.Count -eq 0) {
            throw "$missing`nS'il a été déplacé, indiquez dans Réglages le ou les dossiers où Plecotus doit le rechercher."
        }
        throw "$missing$unavailableText"
    }

    $name = [System.IO.Path]::GetFileName($wavPath)
    $search = Get-PlecotusSearchCandidates -Name $name -Roots $roots.ToArray()
    if ($search.Paths.Count -eq 0 -or $search.Stale) {
        # Index peut-etre perime (fichiers deplaces depuis) : reconstruction puis nouvel essai.
        $search = Get-PlecotusSearchCandidates -Name $name -Roots $roots.ToArray() -RefreshStale
    }
    $candidates = $search.Paths
    if ($candidates.Count -eq 0) {
        throw ("$missing`nAucun fichier « $name » trouvé dans les dossiers de recherche : " + ($roots -join ' ; ') + $unavailableText)
    }
    if ($candidates.Count -gt 1) {
        $shown = @($candidates | Select-Object -First 10)
        $more = if ($candidates.Count -gt 10) { "`n… et " + ($candidates.Count - 10) + ' autres.' } else { '' }
        throw ("Plusieurs fichiers « $name » ont été trouvés ($($candidates.Count)) ; aucun n'a été ouvert. " +
            "Retirez les copies en double ou limitez les dossiers de recherche dans Réglages :`n" + ($shown -join "`n") + $more)
    }
    return @{ Path = $candidates[0]; Relocated = $true }
}

function Get-PlecotusWavArgument {
    param([string]$Path)
    # Un seul argument Windows. Les guillemets et controles sont deja rejetes,
    # et l'extension .wav interdit une barre oblique finale.
    return '"' + $Path + '"'
}

function Get-PlecotusStartInfo {
    param(
        [string]$Executable,
        [string]$File,
        [ValidateSet('kaleidoscope', 'chirosurf')][string]$Viewer = 'kaleidoscope'
    )
    $exePath = Get-PlecotusAbsolutePath -Path $Executable -Kind executable -Viewer $Viewer
    $wavPath = Get-PlecotusAbsolutePath -Path $File -Kind audio
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $exePath
    $startInfo.Arguments = Get-PlecotusWavArgument -Path $wavPath
    $startInfo.UseShellExecute = $false
    $startInfo.WorkingDirectory = [System.IO.Path]::GetDirectoryName($exePath)
    $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Normal
    return $startInfo
}

function Start-PlecotusRecording {
    param(
        [string]$Executable,
        [string]$File,
        [ValidateSet('kaleidoscope', 'chirosurf')][string]$Viewer = 'kaleidoscope',
        [object[]]$SearchFolders = @()
    )
    # Le logiciel est verifie avant une eventuelle recherche, plus longue.
    $null = Get-PlecotusAbsolutePath -Path $Executable -Kind executable -Viewer $Viewer
    $resolution = Find-PlecotusRecording -File $File -SearchFolders $SearchFolders
    $startInfo = Get-PlecotusStartInfo -Executable $Executable -File $resolution.Path -Viewer $Viewer
    $viewerName = if ($Viewer -eq 'chirosurf') { 'ChiroSurf' } else { 'Kaleidoscope' }
    try {
        $process = [System.Diagnostics.Process]::Start($startInfo)
        if ($null -eq $process) { throw 'Aucun processus créé.' }
        $process.Dispose()
    }
    catch {
        throw "$viewerName n'a pas pu démarrer. Vérifiez le chemin et les autorisations Windows. $($_.Exception.Message)"
    }
    return $resolution
}

function Start-PlecotusKaleidoscope {
    param([string]$Executable, [string]$File)
    Start-PlecotusRecording -Executable $Executable -File $File -Viewer kaleidoscope
}

function New-PlecotusResult {
    param([int]$StatusCode = 200, $Data, [string]$Html, [switch]$Stop)
    if ($PSBoundParameters.ContainsKey('Html')) {
        return @{ StatusCode = $StatusCode; ContentType = 'text/html; charset=utf-8'; Body = $Html; Stop = $false }
    }
    return @{
        StatusCode = $StatusCode
        ContentType = 'application/json; charset=utf-8'
        Body = ($Data | ConvertTo-Json -Depth 5 -Compress)
        Stop = [bool]$Stop
    }
}

function Read-PlecotusRequest {
    param([System.IO.Stream]$Stream)
    $readTimer = [System.Diagnostics.Stopwatch]::StartNew()
    $headerBuffer = New-Object System.IO.MemoryStream
    try {
        $lastFour = 0
        while ($true) {
            $remainingMs = 5000 - [int]$readTimer.ElapsedMilliseconds
            if ($remainingMs -le 0) { throw 'Requête HTTP trop lente.' }
            if ($Stream.CanTimeout) { $Stream.ReadTimeout = $remainingMs }
            $nextByte = $Stream.ReadByte()
            if ($nextByte -lt 0) { throw 'Requête HTTP incomplète.' }
            $headerBuffer.WriteByte([byte]$nextByte)
            if ($headerBuffer.Length -gt 16384) { throw 'En-têtes HTTP trop longs.' }
            $lastFour = (($lastFour -shl 8) -bor $nextByte) -band 0xFFFFFFFFL
            if ($lastFour -eq 0x0D0A0D0A) { break }
        }
        $headerText = [System.Text.Encoding]::ASCII.GetString($headerBuffer.ToArray())
    }
    finally { $headerBuffer.Dispose() }
    $lines = $headerText.Split([string[]]@("`r`n"), [System.StringSplitOptions]::None)
    if ($lines[0] -notmatch '^([A-Z]+) ([^\s]+) HTTP/1\.[01]$') { throw 'Requête HTTP invalide.' }
    $method = $Matches[1]
    $target = $Matches[2]
    $headers = @{}
    for ($i = 1; $i -lt ($lines.Length - 2); $i++) {
        if ($lines[$i] -notmatch '^([A-Za-z0-9!#$%&''*+.^_`|~-]+):[ \t]*([^\r\n]*)$') {
            throw 'En-tête HTTP invalide.'
        }
        $name = $Matches[1].ToLowerInvariant()
        if ($headers.ContainsKey($name)) { throw 'En-tête HTTP dupliqué.' }
        $headers[$name] = $Matches[2].Trim()
    }
    if ($headers.ContainsKey('transfer-encoding')) { throw 'Encodage HTTP non pris en charge.' }
    $contentLength = 0
    if ($headers.ContainsKey('content-length')) {
        if (-not [int]::TryParse($headers['content-length'], [ref]$contentLength) -or $contentLength -lt 0) {
            throw 'Longueur HTTP invalide.'
        }
    }
    if ($contentLength -gt 32768) { throw 'Requête trop volumineuse (32 Ko maximum).' }
    if ($method -eq 'POST' -and -not $headers.ContainsKey('content-length')) {
        throw 'La longueur du contenu HTTP est obligatoire.'
    }
    if ($method -ne 'POST' -and $contentLength -ne 0) { throw 'Contenu HTTP inattendu.' }
    $bodyBytes = New-Object byte[] $contentLength
    $offset = 0
    while ($offset -lt $contentLength) {
        $remainingMs = 5000 - [int]$readTimer.ElapsedMilliseconds
        if ($remainingMs -le 0) { throw 'Requête HTTP trop lente.' }
        if ($Stream.CanTimeout) { $Stream.ReadTimeout = $remainingMs }
        $readCount = $Stream.Read($bodyBytes, $offset, $contentLength - $offset)
        if ($readCount -le 0) { throw 'Contenu HTTP incomplet.' }
        $offset += $readCount
    }
    try {
        $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
        $body = $utf8.GetString($bodyBytes)
    }
    catch { throw 'Le contenu HTTP doit être encodé en UTF-8.' }
    return @{ Method = $method; Target = $target; Headers = $headers; Body = $body }
}

function Invoke-PlecotusRequest {
    param([hashtable]$Request)
    $headers = $Request.Headers
    if (-not $headers.ContainsKey('host') -or $headers['host'] -cne '127.0.0.1:4174') {
        return New-PlecotusResult -StatusCode 403 -Data @{ ok = $false; error = 'Adresse locale non autorisée.' }
    }
    if ($Request.Method -eq 'GET' -and $Request.Target -eq '/api/status') {
        return New-PlecotusResult -Data @{ ok = $true; app = 'plecotus-local'; version = 2; launchAvailable = $true; wavSearch = $true; supportedViewers = @('kaleidoscope', 'chirosurf') }
    }
    if ($Request.Method -eq 'GET' -and $Request.Target -eq '/METHODS.md') {
        $methodsPath = Join-Path $script:PlecotusDirectory 'METHODS.md'
        if (-not [System.IO.File]::Exists($methodsPath)) {
            return New-PlecotusResult -StatusCode 404 -Data @{ ok = $false; error = 'Le guide METHODS.md est introuvable dans le dossier Plecotus.' }
        }
        return @{
            StatusCode = 200
            ContentType = 'text/plain; charset=utf-8'
            Body = [System.IO.File]::ReadAllText($methodsPath, [System.Text.Encoding]::UTF8)
            Stop = $false
        }
    }
    if ($Request.Method -eq 'GET' -and $Request.Target -in @('/', '/Plecotus.html')) {
        $htmlPath = Join-Path $script:PlecotusDirectory 'Plecotus.html'
        if (-not [System.IO.File]::Exists($htmlPath)) {
            return New-PlecotusResult -StatusCode 404 -Data @{ ok = $false; error = 'Plecotus.html est introuvable. Conservez les fichiers du paquet dans le même dossier.' }
        }
        $html = [System.IO.File]::ReadAllText($htmlPath, [System.Text.Encoding]::UTF8)
        $meta = '<meta name="plecotus-local-token" content="' + $script:PlecotusToken + '">'
        $headPattern = New-Object System.Text.RegularExpressions.Regex('(?i)</head>')
        $html = $headPattern.Replace($html, ($meta + '</head>'), 1)
        return New-PlecotusResult -Html $html
    }
    if ($Request.Target -in @('/api/kaleidoscope', '/api/open-recording', '/api/stop')) {
        if ($Request.Method -ne 'POST') {
            return New-PlecotusResult -StatusCode 405 -Data @{ ok = $false; error = 'Cette action nécessite une requête POST.' }
        }
        if (-not $headers.ContainsKey('origin') -or $headers['origin'] -cne $script:PlecotusOrigin -or
            -not $headers.ContainsKey('x-plecotus-token') -or
            [string]::IsNullOrEmpty($script:PlecotusToken) -or
            $headers['x-plecotus-token'] -cne $script:PlecotusToken) {
            return New-PlecotusResult -StatusCode 403 -Data @{ ok = $false; error = 'Action locale non autorisée. Rechargez Plecotus depuis son lanceur.' }
        }
        if ($Request.Target -eq '/api/stop') {
            return New-PlecotusResult -Data @{ ok = $true } -Stop
        }
        if (-not $headers.ContainsKey('content-type') -or
            $headers['content-type'] -notmatch '^application/json(?:\s*;\s*charset=utf-8)?$') {
            return New-PlecotusResult -StatusCode 415 -Data @{ ok = $false; error = 'Le contenu doit être un objet JSON UTF-8.' }
        }
        try {
            $payload = $Request.Body | ConvertFrom-Json
            if ($null -eq $payload -or $payload -isnot [pscustomobject] -or
                $null -eq $payload.PSObject.Properties['executable'] -or
                $null -eq $payload.PSObject.Properties['file'] -or
                $payload.executable -isnot [string] -or $payload.file -isnot [string]) {
                throw 'Renseignez le chemin du logiciel et celui du fichier WAV.'
            }
            $viewer = 'kaleidoscope'
            if ($Request.Target -eq '/api/open-recording') {
                if ($null -eq $payload.PSObject.Properties['viewer'] -or
                    $payload.viewer -isnot [string] -or
                    $payload.viewer -cnotin @('kaleidoscope', 'chirosurf')) {
                    throw 'Choisissez le logiciel Kaleidoscope ou ChiroSurf dans les paramètres.'
                }
                $viewer = $payload.viewer
            }
            elseif ($null -ne $payload.PSObject.Properties['viewer'] -and
                ($payload.viewer -isnot [string] -or $payload.viewer -cne 'kaleidoscope')) {
                throw 'Cette adresse historique est réservée à Kaleidoscope.'
            }
            $searchFolders = @()
            if ($null -ne $payload.PSObject.Properties['searchFolders'] -and $null -ne $payload.searchFolders) {
                $value = $payload.searchFolders
                if ($value -isnot [array]) { throw 'Les dossiers de recherche doivent former une liste de chemins.' }
                if ($value.Count -gt $script:PlecotusMaxSearchFolders) {
                    throw "Indiquez au maximum $($script:PlecotusMaxSearchFolders) dossiers de recherche."
                }
                foreach ($folder in $value) {
                    if ($folder -isnot [string]) { throw 'Chaque dossier de recherche doit être un chemin.' }
                }
                $searchFolders = $value
            }
            $resolution = Start-PlecotusRecording -Executable $payload.executable -File $payload.file -Viewer $viewer -SearchFolders $searchFolders
            return New-PlecotusResult -Data @{ ok = $true; file = $resolution.Path; relocated = [bool]$resolution.Relocated }
        }
        catch {
            return New-PlecotusResult -StatusCode 422 -Data @{ ok = $false; error = $_.Exception.Message }
        }
    }
    return New-PlecotusResult -StatusCode 404 -Data @{ ok = $false; error = 'Cette adresse ne fait pas partie de Plecotus.' }
}

function Write-PlecotusResponse {
    param([System.IO.Stream]$Stream, [hashtable]$Result)
    $reason = switch ($Result.StatusCode) {
        200 { 'OK' }; 400 { 'Bad Request' }; 403 { 'Forbidden' }; 404 { 'Not Found' }
        405 { 'Method Not Allowed' }; 415 { 'Unsupported Media Type' }; 422 { 'Unprocessable Content' }
        default { 'Internal Server Error' }
    }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$Result.Body)
    $responseHeader = "HTTP/1.1 $($Result.StatusCode) $reason`r`nContent-Type: $($Result.ContentType)`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nX-Frame-Options: DENY`r`nReferrer-Policy: no-referrer`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($responseHeader)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    $Stream.Write($bytes, 0, $bytes.Length)
    $Stream.Flush()
}

function Open-PlecotusBrowser {
    $browser = New-Object System.Diagnostics.ProcessStartInfo
    $browser.FileName = $script:PlecotusOrigin + '/Plecotus.html'
    $browser.UseShellExecute = $true
    $process = [System.Diagnostics.Process]::Start($browser)
    if ($null -ne $process) { $process.Dispose() }
}

function Test-ExistingPlecotus {
    try {
        $request = [System.Net.HttpWebRequest]::Create($script:PlecotusOrigin + '/api/status')
        $request.Timeout = 1500
        $request.ReadWriteTimeout = 1500
        $request.Proxy = $null
        $request.AllowAutoRedirect = $false
        $response = $request.GetResponse()
        try {
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
            try {
                $statusTimer = [System.Diagnostics.Stopwatch]::StartNew()
                $statusText = New-Object System.Text.StringBuilder
                while ($true) {
                    if ($statusTimer.ElapsedMilliseconds -gt 1500) { return $false }
                    $character = $reader.Read()
                    if ($character -lt 0) { break }
                    if ($statusText.Length -ge 4096) { return $false }
                    [void]$statusText.Append([char]$character)
                }
                $status = $statusText.ToString() | ConvertFrom-Json
            }
            finally { $reader.Dispose() }
        }
        finally { $response.Dispose() }
        return ($status.ok -eq $true -and $status.app -ceq 'plecotus-local' -and $status.version -eq 2)
    }
    catch { return $false }
}

function Show-PlecotusStartupError {
    param([string]$Message)
    $logPath = Join-Path $script:PlecotusDirectory 'plecotus-local.log'
    $logText = '[' + [DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss') + '] ' + $Message + [Environment]::NewLine
    try { [System.IO.File]::AppendAllText($logPath, $logText, [System.Text.Encoding]::UTF8) }
    catch {
        $logPath = Join-Path ([System.IO.Path]::GetTempPath()) 'plecotus-local.log'
        try { [System.IO.File]::AppendAllText($logPath, $logText, [System.Text.Encoding]::UTF8) }
        catch { $logPath = '(journal indisponible)' }
    }
    $help = $Message + "`r`n`r`nJournal : " + $logPath + "`r`nVous pouvez toujours ouvrir Plecotus.html directement, sans l'ouverture automatique des WAV."
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show($help, 'Plecotus — démarrage local', 'OK', 'Error')
    }
    catch { Write-Error $help }
}

if ($LibraryOnly) { return }

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $script:PlecotusPort)
try {
    try { $listener.Start() }
    catch {
        if (Test-ExistingPlecotus) {
            if (-not $NoBrowser) { Open-PlecotusBrowser }
            return
        }
        throw "Le port local 4174 est déjà utilisé ou indisponible. Fermez l'autre application qui l'utilise (par exemple une version précédente de Plecotus encore active : redémarrez l'ordinateur ou fermez « Windows PowerShell » dans le Gestionnaire des tâches), puis relancez Demarrer-Plecotus.cmd."
    }
    if (-not [System.IO.File]::Exists((Join-Path $script:PlecotusDirectory 'Plecotus.html'))) {
        throw 'Plecotus.html est introuvable. Décompressez tous les fichiers du paquet dans le même dossier.'
    }
    $randomBytes = New-Object byte[] 32
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($randomBytes) }
    finally { $random.Dispose() }
    $script:PlecotusToken = [Convert]::ToBase64String($randomBytes)
    if (-not $NoBrowser) { Open-PlecotusBrowser }
    $running = $true
    while ($running) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $stream.ReadTimeout = 5000
            $stream.WriteTimeout = 5000
            try {
                $request = Read-PlecotusRequest -Stream $stream
                $result = Invoke-PlecotusRequest -Request $request
            }
            catch {
                $result = New-PlecotusResult -StatusCode 400 -Data @{ ok = $false; error = $_.Exception.Message }
            }
            Write-PlecotusResponse -Stream $stream -Result $result
            if ($result.Stop) { $running = $false }
        }
        catch {
            # Un navigateur peut abandonner une connexion ; le serveur reste disponible.
        }
        finally { $client.Dispose() }
    }
}
catch {
    Show-PlecotusStartupError -Message $_.Exception.Message
    exit 1
}
finally { $listener.Stop() }
