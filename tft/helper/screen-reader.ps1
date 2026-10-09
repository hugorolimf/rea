# Lê da janela do TFT, sem tocar no processo do jogo: ouro, nível e XP (OCR nativo do Windows) e o banco
# de itens (comparação com os ícones do catálogo). Só captura pixels da tela e a posição da janela.
# Leve por construção: um processo persistente, recortes pequenos, e cada leitura só roda quando seu recorte muda.
# Requer Windows PowerShell 5.1 (powershell.exe); o PowerShell 7 não projeta tipos WinRT.
param(
  [string]$Candidates = '',   # JSON [{id,file}] com os ícones de item a comparar
  [int]$IntervalMs = 2500,
  [int]$ParentPid = 0,        # encerra sozinho quando o servidor que o iniciou deixa de existir
  [string]$FullPng = '',      # grava uma captura da tela principal inteira e sai (calibração)
  [string]$TestImage = '',    # usa um arquivo como se fosse a tela, faz uma leitura com diagnóstico e sai
  [string]$TestClient = ''    # "x,y,largura,altura" da área cliente do jogo dentro de -TestImage
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, System.Windows.Forms, System.Runtime.WindowsRuntime
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;using System.Text;using System.Drawing;using System.Drawing.Imaging;using System.Drawing.Drawing2D;using System.Runtime.InteropServices;
public static class Tft {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  // Área cliente da janela do jogo em pixels físicos: {x, y, largura, altura}, ou null se não estiver visível.
  public static int[] Client() {
    int[] found = null;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      var c = new StringBuilder(64); GetClassName(h, c, 64); if (c.ToString() != "UnrealWindow") return true;
      var t = new StringBuilder(64); GetWindowText(h, t, 64); if (!t.ToString().Trim().StartsWith("TFT")) return true;
      RECT r; GetClientRect(h, out r); var p = new POINT(); ClientToScreen(h, ref p);
      if (r.R > 200 && r.B > 200) found = new[] { p.X, p.Y, r.R, r.B };
      return found == null;
    }, IntPtr.Zero);
    return found;
  }
  public static byte[] Bytes(Bitmap b, out int stride) {
    var d = b.LockBits(new Rectangle(0, 0, b.Width, b.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    var bytes = new byte[d.Stride * b.Height]; Marshal.Copy(d.Scan0, bytes, 0, bytes.Length); stride = d.Stride; b.UnlockBits(d); return bytes;
  }
  // Colunas {primeira, última} com algum pixel claro (o texto do HUD); {-1,-1} se não houver.
  public static int[] BrightColumns(Bitmap b, int threshold) {
    int stride; var p = Bytes(b, out stride); int min = b.Width, max = -1;
    for (int x = 0; x < b.Width; x++) for (int y = 0; y < b.Height; y++) { int i = y * stride + x * 4;
      if (p[i] > threshold || p[i + 1] > threshold || p[i + 2] > threshold) { if (x < min) min = x; max = x; break; } }
    return max < 0 ? new[] { -1, -1 } : new[] { min, max };
  }
  // Assinatura 16x16 RGB do miolo de uma região (a moldura do espaço e a borda do ícone ficam de fora).
  public static byte[] Signature(Bitmap b, int x, int y, int w, int h) {
    int ix = x + (int)(w * 0.16), iy = y + (int)(h * 0.16), iw = (int)(w * 0.68), ih = (int)(h * 0.68);
    using (var t = new Bitmap(16, 16, PixelFormat.Format32bppArgb)) { using (var g = Graphics.FromImage(t)) {
        g.InterpolationMode = InterpolationMode.HighQualityBilinear; g.PixelOffsetMode = PixelOffsetMode.Half;
        g.DrawImage(b, new Rectangle(0, 0, 16, 16), new Rectangle(ix, iy, iw, ih), GraphicsUnit.Pixel); }
      int stride; var p = Bytes(t, out stride); var s = new byte[768];
      for (int yy = 0; yy < 16; yy++) for (int xx = 0; xx < 16; xx++) { int i = yy * stride + xx * 4, o = (yy * 16 + xx) * 3; s[o] = p[i + 2]; s[o + 1] = p[i + 1]; s[o + 2] = p[i]; }
      return s; }
  }
  public static int Mean(byte[] s) { long n = 0; foreach (var v in s) n += v; return (int)(n / s.Length); }
  public static int Distance(byte[] a, byte[] b) { long n = 0; for (int i = 0; i < a.Length; i++) n += Math.Abs(a[i] - b[i]); return (int)(n / a.Length); }
  // Como Best, mas tolera o espaço alguns pixels fora do lugar: testa pequenos deslocamentos e fica com o melhor.
  public static int[] BestShifted(Bitmap b, int x, int y, int w, int h, byte[][] candidates) {
    int[] best = { -1, 999, 999 };
    for (int dy = -3; dy <= 3; dy++) for (int dx = -2; dx <= 2; dx++) {
      if (x + dx < 0 || y + dy < 0 || x + dx + w > b.Width || y + dy + h > b.Height) continue;
      var r = Best(Signature(b, x + dx, y + dy, w, h), candidates); if (r[1] < best[1]) best = r; }
    return best;
  }
  // {índice do melhor, distância do melhor, distância do segundo}.
  public static int[] Best(byte[] s, byte[][] candidates) {
    int best = -1, d1 = 999, d2 = 999;
    for (int i = 0; i < candidates.Length; i++) { int d = Distance(s, candidates[i]); if (d < d1) { d2 = d1; d1 = d; best = i; } else if (d < d2) d2 = d; }
    return new[] { best, d1, d2 };
  }
}
'@
[void][Tft]::SetProcessDPIAware()
if ($FullPng) {
  $all = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $shot = New-Object System.Drawing.Bitmap $all.Width, $all.Height
  $g = [System.Drawing.Graphics]::FromImage($shot); $g.CopyFromScreen($all.X, $all.Y, 0, 0, $shot.Size); $g.Dispose()
  $shot.Save($FullPng, [System.Drawing.Imaging.ImageFormat]::Png); $shot.Dispose()
  $client = [Tft]::Client()
  [Console]::Out.WriteLine((@{ saved = $true; width = $all.Width; height = $all.Height; client = $client } | ConvertTo-Json -Compress)); exit 0
}
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await($operation, [Type]$type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation)); $task.Wait(); $task.Result }
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { [Console]::Out.WriteLine('{"error":"Nenhum idioma de OCR instalado no Windows."}'); exit 2 }

# Regiões como frações da área cliente do jogo, medidas numa captura 2044x1149 (HUD padrão, janela 16:9).
$GOLD  = @{ X = 0.5316; Y = 0.8191; W = 0.0235; H = 0.0261 }
$LEVEL = @{ X = 0.2009; Y = 0.8174; W = 0.0196; H = 0.0244 } # só o número depois de "Nv."
$XP    = @{ X = 0.2420; Y = 0.8174; W = 0.0284; H = 0.0244 }
$STAGE = @{ X = 0.3982; Y = 0.0070; W = 0.0201; H = 0.0226 } # "3-1" no topo
$SLOT  = @{ X = 0.00709; Y = 0.24374; W = 0.02055; H = 0.0383; Pitch = 0.04875; Count = 10 }
$BAND  = @{ X = 0.14; Y = 0.15; W = 0.72; H = 0.60 } # centro da tela, onde aparecem os cards de escolha
$SHOP  = @{ X = 0.2896; Y = 0.9661; W = 0.0783; H = 0.0244; Pitch = 0.1050; Count = 5 } # faixa do nome de cada carta
$MATCH_MAX = 30   # distância média por canal aceita como o mesmo ícone
$EMPTY_MAX = 14   # brilho médio de um espaço vazio

function Recognize([System.Drawing.Bitmap]$image, [switch]$Lines) {
  $memory = New-Object System.IO.MemoryStream; $image.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
  $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $writer = New-Object Windows.Storage.Streams.DataWriter $stream
  $writer.WriteBytes($memory.ToArray()); $null = Await ($writer.StoreAsync()) ([uint32]); $null = $writer.DetachStream(); $stream.Seek(0); $memory.Dispose()
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $software = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await ($engine.RecognizeAsync($software)) ([Windows.Media.Ocr.OcrResult])
  $software.Dispose(); $stream.Dispose(); if ($Lines) { $result.Lines | ForEach-Object { $_.Text } } else { $result.Text }
}
# Amplia o recorte 3x. Com -Tile, repete o trecho com texto três vezes colado: o OCR ignora um caractere
# isolado, e a repetição também serve de conferência (as três leituras precisam coincidir).
function Read-Region([System.Drawing.Bitmap]$bitmap, [switch]$Tile, [switch]$Whole) {
  $columns = if ($Whole) { @(0, ($bitmap.Width - 1)) } else { [Tft]::BrightColumns($bitmap, 150) }; if ($columns[1] -lt 0) { return '' }
  $h = $bitmap.Height; $pad = [Math]::Max(1, [int]($h * 0.06))
  $sx = [Math]::Max(0, $columns[0] - $pad); $sw = [Math]::Min($bitmap.Width, $columns[1] + $pad + 1) - $sx
  $tw = $sw * 3; $th = $h * 3; $margin = $th; $copies = if ($Tile) { 3 } else { 1 }
  $scaled = New-Object System.Drawing.Bitmap ($tw * $copies + $margin * 2), $th
  $g = [System.Drawing.Graphics]::FromImage($scaled); $g.InterpolationMode = 'HighQualityBicubic'; $g.Clear($bitmap.GetPixel(0, 0))
  for ($n = 0; $n -lt $copies; $n++) { $g.DrawImage($bitmap, (New-Object System.Drawing.Rectangle ($margin + $tw * $n), 0, $tw, $th), (New-Object System.Drawing.Rectangle $sx, 0, $sw, $h), 'Pixel') }
  $g.Dispose(); $text = Recognize $scaled; $scaled.Dispose(); $text
}
function Digits($text) { $text -replace '[Oo]', '0' -replace '[lI|]', '1' -replace '[^0-9]', '' }
function Parse-Tiled($text) {
  $d = Digits $text
  if ($d.Length -ge 3 -and $d.Length -le 9 -and $d.Length % 3 -eq 0) { $n = $d.Length / 3; $part = $d.Substring(0, $n); if ($d -eq ($part * 3)) { return [int]$part } }
  $null
}

$ids = @(); $signatures = New-Object 'System.Collections.Generic.List[byte[]]'
if ($Candidates -and (Test-Path $Candidates)) {
  foreach ($entry in (Get-Content -Raw -Encoding UTF8 $Candidates | ConvertFrom-Json)) {
    try { $icon = New-Object System.Drawing.Bitmap $entry.file; $signatures.Add([Tft]::Signature($icon, 0, 0, $icon.Width, $icon.Height)); $ids += $entry.id; $icon.Dispose() } catch {}
  }
}
$signatureArray = $signatures.ToArray()

$testBitmap = $null
if ($TestImage) { $testBitmap = New-Object System.Drawing.Bitmap $TestImage }
function Grab($client, $region, $y, $h) {
  $rx = [int]($client[0] + $client[2] * $region.X); $ry = [int]($client[1] + $client[3] * $y)
  $rw = [Math]::Max(8, [int]($client[2] * $region.W)); $rh = [Math]::Max(8, [int]($client[3] * $h))
  $bitmap = New-Object System.Drawing.Bitmap $rw, $rh; $g = [System.Drawing.Graphics]::FromImage($bitmap)
  if ($testBitmap) { $g.DrawImage($testBitmap, (New-Object System.Drawing.Rectangle 0, 0, $rw, $rh), (New-Object System.Drawing.Rectangle $rx, $ry, $rw, $rh), 'Pixel') }
  else { $g.CopyFromScreen($rx, $ry, 0, 0, $bitmap.Size) }
  $g.Dispose(); $bitmap
}
$md5 = [System.Security.Cryptography.MD5]::Create()
function Hash([System.Drawing.Bitmap]$bitmap) { $stride = 0; [BitConverter]::ToString($md5.ComputeHash([Tft]::Bytes($bitmap, [ref]$stride))) }

$removerSlots = @{}; $tick = 0; $cardLines = @()
$state = @{ window = $false; removers = $null; stage = $null; gold = $null; level = $null; xp = $null; items = @(); unknownItems = 0; shop = @('', '', '', '', '') }
$hashes = @{}; $slotSignatures = @{}; $slotValues = @{}; $lastLine = ''
while ($true) {
  $debug = @()
  try {
    $client = if ($TestImage) { $TestClient -split ',' | ForEach-Object { [int]$_ } } else { [Tft]::Client() }
    if (-not $client) { $state.window = $false }
    else {
      $state.window = $true
      foreach ($field in 'gold', 'level', 'xp', 'stage') {
        $region = @{ gold = $GOLD; level = $LEVEL; xp = $XP; stage = $STAGE }[$field]
        $bitmap = Grab $client $region $region.Y $region.H; $hash = Hash $bitmap
        if ($hashes[$field] -ne $hash) {
          $hashes[$field] = $hash
          if ($field -eq 'gold') { $text = Read-Region $bitmap -Tile; $state.gold = Parse-Tiled $text }
          elseif ($field -eq 'level') { $text = Read-Region $bitmap -Tile; $n = Parse-Tiled $text; $state.level = if ($null -ne $n -and $n -ge 1 -and $n -le 11) { $n } else { $null } }
          elseif ($field -eq 'stage') { $text = Read-Region $bitmap -Tile; $n = Parse-Tiled $text; $state.stage = if ($null -ne $n -and $n -ge 11 -and $n -le 97 -and $n % 10 -ge 1 -and $n % 10 -le 7) { '' + [Math]::Floor($n / 10) + '-' + ($n % 10) } else { $null } }
          else { $text = Read-Region $bitmap; $state.xp = if ($text -match '(\d{1,3})\s*/\s*(\d{1,3})') { $Matches[1] + '/' + $Matches[2] } else { $null } }
          $debug += "$field='$text'"
        }
        $bitmap.Dispose()
      }
      # Cards de escolha: OCR da faixa central, só em rodadas iniciais do estágio (ou estágio não lido) e em laços alternados.
      $tick++; $round = if ($state.stage) { [int]$state.stage.Substring(2) } else { 0 }
      if ($round -le 2) { if ($tick % 2 -eq 0 -or $TestImage) { $wide = Grab $client $BAND $BAND.Y $BAND.H; $cardLines = @(Recognize $wide -Lines | Where-Object { $_ -and $_.Length -ge 4 } | Select-Object -First 40 | ForEach-Object { [string]$_ }); $wide.Dispose() } } else { $cardLines = @() }
      # Loja: o nome de cada carta é texto; carta vazia (comprada) não tem pixels claros e vira ''.
      for ($i = 0; $i -lt $SHOP.Count; $i++) {
        $card = @{ X = $SHOP.X + $SHOP.Pitch * $i; W = $SHOP.W }
        $bitmap = Grab $client $card $SHOP.Y $SHOP.H; $hash = Hash $bitmap
        if ($hashes["shop$i"] -ne $hash) { $hashes["shop$i"] = $hash; $text = (Read-Region $bitmap).Trim(); $state.shop[$i] = $text; $debug += "shop$i='$text'" }
        $bitmap.Dispose()
      }
      # Banco de itens: uma captura da coluna inteira; cada espaço só é reclassificado quando muda.
      $column = Grab $client $SLOT $SLOT.Y ($SLOT.Pitch * ($SLOT.Count - 1) + $SLOT.H)
      $slotH = [int]($client[3] * $SLOT.H)
      for ($i = 0; $i -lt $SLOT.Count; $i++) {
        $signature = [Tft]::Signature($column, 0, [int]($client[3] * $SLOT.Pitch * $i), $column.Width, $slotH)
        if ($slotSignatures[$i] -and [Tft]::Distance($signature, $slotSignatures[$i]) -lt 4) { continue }
        $slotSignatures[$i] = $signature
        $removerSlots.Remove($i)
        if ([Tft]::Mean($signature) -le $EMPTY_MAX) { $slotValues[$i] = ''; $debug += "slot$i=vazio"; continue }
        if ($signatureArray.Length) { $best = [Tft]::BestShifted($column, 0, [int]($client[3] * $SLOT.Pitch * $i), $column.Width, $slotH, $signatureArray); $slotValues[$i] = if ($best[1] -le $MATCH_MAX -and $best[2] - $best[1] -ge 8) { $ids[$best[0]] } else { '?' }; $debug += "slot$i=$($ids[$best[0]]) d=$($best[1]) segundo=$($best[2])" }
        else { $slotValues[$i] = '?' }
        # Removedor empilha: o número no canto superior esquerdo do ícone é a quantidade.
        if ($slotValues[$i] -match 'ItemRemover') {
          $sy = [int]($client[3] * $SLOT.Pitch * $i); $bw = [int]($column.Width * 0.44); $bh = [int]($slotH * 0.44); $badge = $column.Clone((New-Object System.Drawing.Rectangle 0, $sy, $bw, $bh), $column.PixelFormat)
          $badgeText = Read-Region $badge -Tile -Whole; $count = Parse-Tiled $badgeText; $debug += "selo='$badgeText'"; $badge.Dispose(); $removerSlots[$i] = if ($null -ne $count -and $count -ge 1 -and $count -le 99) { $count } else { 1 }; $debug += "slot$i removedores=$($removerSlots[$i])"
        }
      }
      $column.Dispose()
      $state.items = @(0..($SLOT.Count - 1) | ForEach-Object { $slotValues[$_] } | Where-Object { $_ -and $_ -ne '?' })
      $state.unknownItems = @(0..($SLOT.Count - 1) | Where-Object { $slotValues[$_] -eq '?' }).Count
      $state.removers = ($removerSlots.Values | Measure-Object -Sum).Sum; if ($null -eq $state.removers) { $state.removers = 0 }
    }
    $line = (@{ window = $state.window; removers = $state.removers; stage = $state.stage; gold = $state.gold; level = $state.level; xp = $state.xp; items = @($state.items); unknownItems = $state.unknownItems; shop = @($state.shop); band = @($cardLines) } | ConvertTo-Json -Compress)
    if ($line -ne $lastLine) { $lastLine = $line; [Console]::Out.WriteLine($line) }
    if ($TestImage) { $debug | ForEach-Object { [Console]::Out.WriteLine($_) } }
  } catch { [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress)) }
  if ($TestImage) { break }
  if ($ParentPid -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds $IntervalMs
}
