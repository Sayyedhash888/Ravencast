# Extracts only the assets the game needs out of the source .zip packs
# into game/public/assets, preserving the flat layout the glTF files expect.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$pub  = Join-Path $root 'game\public\assets'

function Extract-Zip {
    param(
        [string]$ZipPath,
        [string]$Prefix,       # entry path prefix to match
        [string]$DestDir,      # output dir (entry path after prefix is used as name)
        [string[]]$Extensions, # optional extension filter
        [string]$Exclude       # optional substring filter
    )
    $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $count = 0
        foreach ($e in $zip.Entries) {
            if ($Exclude -and $e.FullName -like "*$Exclude*") { continue }
            # packs may nest everything under a top-level folder, so match the
            # prefix anywhere in the path and keep only what follows it
            $at = $e.FullName.IndexOf($Prefix)
            if ($at -lt 0) { continue }
            $rel = $e.FullName.Substring($at + $Prefix.Length)
            if ([string]::IsNullOrWhiteSpace($rel)) { continue }
            if ($Extensions) {
                $ext = [System.IO.Path]::GetExtension($rel).ToLower()
                if ($Extensions -notcontains $ext) { continue }
            }
            $dest = Join-Path $DestDir $rel
            $parent = Split-Path -Parent $dest
            if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
            $count++
        }
        Write-Host ("  {0,-46} -> {1,4} files" -f (Split-Path -Leaf $ZipPath), $count)
    }
    finally { $zip.Dispose() }
}

Write-Host 'Extracting assets...'

# --- Nature kit: the whole flat glTF folder (models + .bin + shared textures) ---
Extract-Zip -ZipPath (Join-Path $root 'Stylized Nature MegaKit[Standard].zip') `
            -Prefix 'glTF/' -DestDir (Join-Path $pub 'nature')

# --- Player character: rigged Male Ranger outfit (glTF + bin + its textures) ---
$outfits = Join-Path $pub 'chars'
Extract-Zip -ZipPath (Join-Path $root 'Modular Character Outfits - Fantasy[Standard].zip') `
            -Prefix 'Exports/glTF (Godot-Unreal)/Outfits/' -DestDir $outfits `
            -Extensions @('.gltf', '.bin', '.png')

# --- Base characters: the actual heads the outfits were authored for ---
# the outfits are clothing only; this kit supplies the head, eyes, brows and
# hair styles that go with the same skeleton (see src/game/Head.js)
$baseChars = Join-Path $outfits 'base'
Extract-Zip -ZipPath (Join-Path $root 'Universal Base Characters[Standard].zip') `
            -Prefix 'Base Characters/Godot - UE/' -DestDir $baseChars `
            -Extensions @('.gltf', '.bin', '.png')
Extract-Zip -ZipPath (Join-Path $root 'Universal Base Characters[Standard].zip') `
            -Prefix 'Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/' -DestDir (Join-Path $baseChars 'hair') `
            -Extensions @('.gltf', '.bin', '.png')
# the kit's body glTFs reference *_png.png names that the folder does not ship;
# alias the real files so the loader and gltf-transform find them
foreach ($alias in @(
    @{ From = 'T_Eye_Normal.png';    To = 'T_Eye_Normal_png.png' },
    @{ From = 'T_Hair_1_Normal.png'; To = 'T_Hair_1_Normal_png.png' }
)) {
    $from = Join-Path $baseChars $alias.From
    if (Test-Path $from) { Copy-Item $from (Join-Path $baseChars $alias.To) -Force }
}

# --- Medieval Village MegaKit: modular building pieces (walls, roofs, doors) ---
Extract-Zip -ZipPath (Join-Path $root 'Medieval Village MegaKit[Standard].zip') `
            -Prefix 'glTF/' -DestDir (Join-Path $pub 'village') `
            -Extensions @('.gltf', '.bin', '.png')

# --- Fantasy Props MegaKit: guild/interior furnishing ---
Extract-Zip -ZipPath (Join-Path $root 'Fantasy Props MegaKit[Standard].zip') `
            -Prefix 'Exports/glTF/' -DestDir (Join-Path $pub 'props') `
            -Extensions @('.gltf', '.bin', '.png')


# --- Animation libraries (43 clips each, shared UE5 skeleton) ---
Extract-Zip -ZipPath (Join-Path $root 'Universal Animation Library[Standard].zip') `
            -Prefix 'Unreal-Godot/' -DestDir (Join-Path $pub 'anim') -Extensions @('.glb')
# the UAL2 zip also carries a female mannequin under an Unreal-Godot/ folder;
# it is extracted separately below, into chars/
Extract-Zip -ZipPath (Join-Path $root 'Universal Animation Library 2[Standard].zip') `
            -Prefix 'Unreal-Godot/' -DestDir (Join-Path $pub 'anim') `
            -Extensions @('.glb') -Exclude 'Mannequin'

# --- Monsters (self-contained GLBs with embedded textures) ---
Extract-Zip -ZipPath (Join-Path $root 'Bestiary - Dungeon Monsters Kit[Standard].zip') `
            -Prefix 'Exports/GLB (Godot-Unreal)/' -DestDir (Join-Path $pub 'monsters') -Extensions @('.glb')

# --- Music: hand-supplied beds that are not part of any asset pack ---
$audio = Join-Path $pub 'audio'
New-Item -ItemType Directory -Force -Path $audio | Out-Null
$musicMap = @(
    @{ Src = 'Sound\(for town)Hearth_at_the_Stone_Gate.mp3';        As = 'town.mp3' },
    @{ Src = 'Sound\(normal fight)Beneath_the_Iron_Canopy.mp3';     As = 'combat.mp3' },
    @{ Src = 'Sound\(for boss fight)The_Warden_s_Wake.mp3';         As = 'boss.mp3' }
)
$copied = 0
foreach ($m in $musicMap) {
    $src = Join-Path $root $m.Src
    if (-not (Test-Path $src)) { continue }
    $dest = Join-Path $audio $m.As
    # the supplied MP3s carry encoder tags that Chrome's decoder rejects now
    # and then; a clean 128 kbps copy is smaller and decodes everywhere
    if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
        & ffmpeg -y -v error -i $src -codec:a libmp3lame -b:a 128k -ar 44100 -ac 2 -map_metadata -1 $dest
    }
    if (-not (Test-Path $dest)) { Copy-Item $src $dest -Force }
    $copied++
}
Write-Host ("  {0,-46} -> {1,4} files" -f 'music', $copied)

# --- Licenses, for attribution ---
$lic = Join-Path $pub 'licenses'
New-Item -ItemType Directory -Force -Path $lic | Out-Null
$licenseMap = @(
    @{ Zip = 'Universal Animation Library[Standard].zip';        Entry = 'License.txt';         As = 'Universal Animation Library - CC0.txt' },
    @{ Zip = 'Universal Animation Library 2[Standard].zip';      Entry = 'License.txt';         As = 'Universal Animation Library 2 - CC0.txt' },
    @{ Zip = 'Bestiary - Dungeon Monsters Kit[Standard].zip';    Entry = 'License_Standard.txt'; As = 'Bestiary - Dungeon Monsters Kit.txt' },
    @{ Zip = 'Stylized Nature MegaKit[Standard].zip';            Entry = 'License_Standard.txt'; As = 'Stylized Nature MegaKit.txt' },
    @{ Zip = 'Modular Character Outfits - Fantasy[Standard].zip'; Entry = 'License_Standard.txt'; As = 'Modular Character Outfits - Fantasy.txt' },
    @{ Zip = 'Medieval Village MegaKit[Standard].zip';           Entry = 'License_Standard.txt'; As = 'Medieval Village MegaKit.txt' },
    @{ Zip = 'Fantasy Props MegaKit[Standard].zip';              Entry = 'License_Standard.txt'; As = 'Fantasy Props MegaKit.txt' },
    @{ Zip = 'Universal Base Characters[Standard].zip';          Entry = 'License_Standard.txt'; As = 'Universal Base Characters - CC0.txt' }
)
foreach ($m in $licenseMap) {
    $zip = [System.IO.Compression.ZipFile]::OpenRead((Join-Path $root $m.Zip))
    try {
        $e = $zip.Entries | Where-Object { $_.Name -eq $m.Entry } | Select-Object -First 1
        if ($e) {
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, (Join-Path $lic $m.As), $true)
        }
    }
    finally { $zip.Dispose() }
}
Write-Host ("  {0,-46} -> {1,4} files" -f 'licenses', $licenseMap.Count)

Write-Host 'Done.'
