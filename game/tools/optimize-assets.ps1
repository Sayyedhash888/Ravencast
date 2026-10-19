# Shrinks the extracted assets to something sane for a browser download.
#
#  - nature: the source PNGs are 2K-4K and shared between props, so they are
#    downscaled in place (keeps the flat glTF layout the files expect)
#  - player + monsters: repacked into a single self-contained GLB with
#    1024px WebP textures
#  - animation libraries: keyframe-resampled (lossless) and the unused
#    mannequin meshes dropped, leaving animation data only
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pub  = Join-Path $root 'public\assets'
Set-Location $root

function Invoke-Gltf {
    param([string[]]$GltfArgs, [string]$Label)
    Write-Host "  $Label"
    & npx --no-install gltf-transform @GltfArgs
    if ($LASTEXITCODE -ne 0) { throw "gltf-transform failed: $($GltfArgs -join ' ')" }
}

Write-Host 'Resizing shared nature textures...'
python (Join-Path $PSScriptRoot 'resize_textures.py') (Join-Path $pub 'nature') 1024
Write-Host 'Encoding nature textures to WebP...'
python (Join-Path $PSScriptRoot 'webp_textures.py') (Join-Path $pub 'nature')

# The village and props kits are laid out like the nature kit: many small
# models sharing a handful of large tiling textures, so the same
# resize-then-WebP-then-repoint treatment applies.
foreach ($kit in @('village', 'props')) {
    Write-Host "Resizing $kit textures..."
    python (Join-Path $PSScriptRoot 'resize_textures.py') (Join-Path $pub $kit) 1024
    Write-Host "Encoding $kit textures to WebP..."
    python (Join-Path $PSScriptRoot 'webp_textures.py') (Join-Path $pub $kit)
}

Write-Host 'Packing characters...'
# every outfit is a full rigged body, used as a player skin and as guild NPCs
foreach ($outfit in @('Male_Ranger', 'Male_Peasant', 'Female_Peasant', 'Female_Ranger')) {
    $src = Join-Path $pub "chars\$outfit.gltf"
    if (-not (Test-Path $src)) { Write-Host "  (missing $outfit)"; continue }
    $tmp = Join-Path $pub "chars\_$outfit.glb"
    $out = Join-Path $pub "chars\$outfit.glb"
    Invoke-Gltf @('resize', $src, $tmp, '--width', '1024', '--height', '1024') "$outfit resize"
    Invoke-Gltf @('webp', $tmp, $out, '--quality', '90') "$outfit webp"
    Remove-Item $tmp -Force
}
# drop the loose glTF sources now that everything is inside the GLBs
Get-ChildItem (Join-Path $pub 'chars') -File |
    Where-Object { $_.Extension -in '.gltf', '.bin', '.png' } |
    Remove-Item -Force

Write-Host 'Packing base-character heads...'
# the outfit skins are cut from these bodies at runtime: the head, eyes, brows
# and hair all bind to the same Head bone, so they are packed on their own and
# the heavy body textures only need to be good enough for the face
$baseSrc = Join-Path $pub 'chars\base'
foreach ($body in @(
    @{ Src = 'Superhero_Male_FullBody';   Out = 'Base_Male' },
    @{ Src = 'Superhero_Female_FullBody'; Out = 'Base_Female' }
)) {
    $src = Join-Path $baseSrc "$($body.Src).gltf"
    if (-not (Test-Path $src)) { Write-Host "  (missing $($body.Src))"; continue }
    $tmp = Join-Path $pub "chars\_$($body.Out).glb"
    $out = Join-Path $pub "chars\$($body.Out).glb"
    Invoke-Gltf @('resize', $src, $tmp, '--width', '1024', '--height', '1024') "$($body.Out) resize"
    Invoke-Gltf @('webp', $tmp, $out, '--quality', '90') "$($body.Out) webp"
    Remove-Item $tmp -Force
}

Write-Host 'Packing hairstyles...'
foreach ($style in @('Hair_Buzzed', 'Hair_BuzzedFemale', 'Hair_SimpleParted', 'Hair_Buns', 'Hair_Long', 'Hair_Beard')) {
    $src = Join-Path $baseSrc "hair\$style.gltf"
    if (-not (Test-Path $src)) { Write-Host "  (missing $style)"; continue }
    $tmp = Join-Path $pub "chars\_$style.glb"
    $out = Join-Path $pub "chars\$style.glb"
    Invoke-Gltf @('resize', $src, $tmp, '--width', '512', '--height', '512') "$style resize"
    Invoke-Gltf @('webp', $tmp, $out, '--quality', '90') "$style webp"
    Remove-Item $tmp -Force
}
Get-ChildItem (Join-Path $pub 'chars\base') -Recurse -File |
    Where-Object { $_.Extension -in '.gltf', '.bin', '.png' } |
    Remove-Item -Force

Write-Host 'Packing monsters...'
foreach ($monster in @('Imp', 'Puglin')) {
    $src = Join-Path $pub "monsters\$monster.glb"
    $tmp = Join-Path $pub "monsters\_$monster.glb"
    Invoke-Gltf @('resize', $src, $tmp, '--width', '1024', '--height', '1024') "$monster resize"
    Invoke-Gltf @('webp', $tmp, $src, '--quality', '90') "$monster webp"
    Remove-Item $tmp -Force
}

Write-Host 'Trimming animation libraries...'
# the _RM variants bake root motion in, which fights the character controller
Get-ChildItem (Join-Path $pub 'anim') -Filter '*_RM.glb' | Remove-Item -Force
foreach ($lib in @('UAL1_Standard', 'UAL2_Standard')) {
    $src = Join-Path $pub "anim\$lib.glb"
    $tmp = Join-Path $pub "anim\_$lib.glb"
    Invoke-Gltf @('resample', $src, $tmp) "$lib resample"
    Move-Item $tmp $src -Force
}

Write-Host ''
Write-Host 'Result:'
Get-ChildItem $pub -Recurse -File |
    Group-Object { $_.Directory.Name } |
    Sort-Object Name |
    ForEach-Object {
        '  {0,-12} {1,4} files  {2,7:N1} MB' -f $_.Name, $_.Count,
            (($_.Group | Measure-Object Length -Sum).Sum / 1MB)
    }
