# Harness do teste do banco de itens: roda a classificação do próprio screen-reader.ps1 (tipos C# e Classify-Slot) sobre
# uma coluna de banco já gravada em arquivo, em vários brilhos. Sem OCR e sem captura de tela: só lê pixels de arquivos.
param(
  [string]$Script,      # caminho do screen-reader.ps1
  [string]$ColumnFile,  # PNG da coluna do banco (10 espaços, mesma escala da calibração 2044x1149)
  [string]$Candidates,  # JSON [{id,file}] dos ícones candidatos
  [string]$Out,         # onde gravar o JSON do resultado
  [string]$Dims = '1',  # multiplicadores de brilho separados por vírgula (simulam jogo mais ou menos escurecido)
  [int]$CropX = -1      # com -ColumnFile = faixa (200x576 da calibração): lê a região de 42 px a partir deste x (coluna real = 14; mais à direita = lista de sinergias)
)
$ErrorActionPreference = 'Stop'
$txt = [IO.File]::ReadAllText($Script, [Text.Encoding]::UTF8)
$types = [regex]::Match($txt, "(?s)-TypeDefinition @'\r?\n(.*?)\r?\n'@").Groups[1].Value
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition $types
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Drawing;
public static class Dimmer { public static Bitmap Apply(Bitmap src, double k) {
  var o = new Bitmap(src.Width, src.Height);
  for (int y = 0; y < src.Height; y++) for (int x = 0; x < src.Width; x++) { var p = src.GetPixel(x, y);
    o.SetPixel(x, y, Color.FromArgb(255, Math.Min(255, (int)(p.R * k)), Math.Min(255, (int)(p.G * k)), Math.Min(255, (int)(p.B * k)))); }
  return o; } }
'@
$consts = [regex]::Matches($txt, '(?m)^\$(MATCH_MAX|EMPTY_MAX|EMPTY_FLAT|EMPTY_SPREAD|GAP_MIN|GAP_RATIO|RARE_MAX|RARE_GAP|RARE_RATIO|SAME_ICON)\s*=\s*[0-9.]+|^\$RARE_KIND\s*=\s*''[^'']*''') | ForEach-Object { $_.Value }
Invoke-Expression ($consts -join '; ')
$fn = [regex]::Match($txt, '(?s)function Classify-Slot.*?\r?\n}\r?\n').Value
Invoke-Expression $fn
Invoke-Expression ([regex]::Match($txt, 'function Family-Key[^\r\n]*').Value)
$cands = [IO.File]::ReadAllText($Candidates, [Text.Encoding]::UTF8) | ConvertFrom-Json
$signatures = New-Object 'System.Collections.Generic.List[byte[]]'; $ids = @()
foreach ($e in $cands) { $icon = New-Object System.Drawing.Bitmap $e.file; $signatures.Add([Tft]::Signature($icon, 0, 0, $icon.Width, $icon.Height)); $ids += $e.id; $icon.Dispose() }
$signatureArray = $signatures.ToArray()
$familyKeys = @{}; $families = [int[]]::new($ids.Count)
for ($k = 0; $k -lt $ids.Count; $k++) { $fk = Family-Key $ids[$k]; if (-not $familyKeys.ContainsKey($fk)) { $familyKeys[$fk] = $familyKeys.Count }; $families[$k] = $familyKeys[$fk] }
$original = New-Object System.Drawing.Bitmap $ColumnFile
if ($CropX -ge 0) { $original = $original.Clone((New-Object System.Drawing.Rectangle $CropX, 14, 42, 548), $original.PixelFormat) }
$slotH = 44; $runs = @()
foreach ($dimText in ($Dims -split ',')) {
  $dim = [double]::Parse($dimText, [Globalization.CultureInfo]::InvariantCulture)
  $column = if ($dim -eq 1.0) { $original } else { [Dimmer]::Apply($original, $dim) }
  $slots = @()
  for ($i = 0; $i -lt 10; $i++) { $c = Classify-Slot $column ([int](1149 * 0.04875 * $i)) $slotH; $slots += [pscustomobject]@{ value = $c.value; debug = $c.debug } }
  # Mesmo ícone em outro brilho (como a memória do espaço compara) e ícones diferentes entre si, nos 3 espaços com item.
  $same = @(); $cross = @()
  for ($i = 0; $i -lt 3; $i++) {
    $y = [int](1149 * 0.04875 * $i)
    $now = [Tft]::Signature($column, 0, $y, $column.Width, $slotH)
    $same += [Tft]::Match($now, [Tft]::Signature($original, 0, $y, $original.Width, $slotH))
    for ($j = 0; $j -lt 3; $j++) { if ($j -ne $i) { $cross += [Tft]::Match($now, [Tft]::Signature($original, 0, [int](1149 * 0.04875 * $j), $original.Width, $slotH)) } }
  }
  $runs += [pscustomobject]@{ dim = $dim; slots = $slots; same = $same; cross = $cross; sameIcon = $SAME_ICON; families = @(0..($ids.Count - 1) | ForEach-Object { [pscustomobject]@{ id = $ids[$_]; family = $families[$_] } }) }
}
[IO.File]::WriteAllText($Out, (ConvertTo-Json -InputObject @($runs) -Depth 6 -Compress))
