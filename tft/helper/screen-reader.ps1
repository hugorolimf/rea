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
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  static IntPtr game = IntPtr.Zero;
  // Área cliente da janela do jogo em pixels físicos: {x, y, largura, altura}, ou null se não estiver visível.
  public static int[] Client() {
    int[] found = null; game = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      var c = new StringBuilder(64); GetClassName(h, c, 64); if (c.ToString() != "UnrealWindow") return true;
      var t = new StringBuilder(64); GetWindowText(h, t, 64); if (!t.ToString().Trim().StartsWith("TFT")) return true;
      RECT r; GetClientRect(h, out r); var p = new POINT(); ClientToScreen(h, ref p);
      if (r.R > 200 && r.B > 200) { found = new[] { p.X, p.Y, r.R, r.B }; game = h; }
      return found == null;
    }, IntPtr.Zero);
    return found;
  }
  // O ponto da tela (pixels físicos) mostra a janela do jogo achada por Client(), e não outra janela por cima.
  // Não exige foco: o jogo inteiramente visível com o helper aberto em outro monitor continua sendo lido.
  public static bool Shows(int x, int y) {
    if (game == IntPtr.Zero) return false;
    var p = new POINT(); p.X = x; p.Y = y; var h = WindowFromPoint(p);
    return h != IntPtr.Zero && GetAncestor(h, 2) == game; // 2 = GA_ROOT
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
  // Desvio médio em relação à média: espaço vazio é escuro e liso (poucos pontos), ícone de item tem muito mais.
  public static int Spread(byte[] s) { int m = Mean(s); long n = 0; foreach (var v in s) n += Math.Abs(v - m); return (int)(n / s.Length); }
  // Distância entre a leitura e um candidato, invariante ao brilho (painel de escolha e jogo escurecido mudam o brilho,
  // não a forma): 1 - correlação normalizada por canal (forma) + 2 x diferença de proporção de cor (distingue o
  // removedor comum do dourado). O canto superior esquerdo (selo de quantidade do item empilhado) fica fora.
  public static double Match(byte[] s, byte[] c) {
    double corr = 0; double[] ta = new double[3], tb = new double[3]; double sa = 0, sb = 0;
    for (int k = 0; k < 3; k++) {
      double ms = 0, mc = 0; int n = 0;
      for (int y = 0; y < 16; y++) for (int x = 0; x < 16; x++) { if (x < 7 && y < 7) continue; int i = (y * 16 + x) * 3 + k; ms += s[i]; mc += c[i]; n++; }
      ta[k] = ms; tb[k] = mc; sa += ms; sb += mc; ms /= n; mc /= n;
      double a = 0, b = 0, ab = 0;
      for (int y = 0; y < 16; y++) for (int x = 0; x < 16; x++) { if (x < 7 && y < 7) continue; int i = (y * 16 + x) * 3 + k; double u = s[i] - ms, v = c[i] - mc; a += u * u; b += v * v; ab += u * v; }
      corr += (a > 0 && b > 0) ? 1 - ab / Math.Sqrt(a * b) : 1;
    }
    double chroma = 0; if (sa > 0 && sb > 0) for (int k = 0; k < 3; k++) chroma += Math.Abs(ta[k] / sa - tb[k] / sb); else chroma = 1;
    return corr / 3 + 2 * chroma;
  }
  // Acha a moldura da coluna do banco numa faixa capturada (coordenadas da faixa): a coluna é uma fila de quadros escuros
  // com uma linha clara fina em cada borda lateral, medida na calibração (luma, escala 1; ver o molde abaixo). Perfil
  // horizontal = luma média das linhas internas dos `count` espaços (o ícone dentro do espaço não altera a linha da borda);
  // compara com o molde esticado por `scale` (altura da janela / 1149), por correlação normalizada (invariante ao brilho).
  // Devolve {x onde começa o interior do espaço (a coluna do banco), correlação, contraste da linha clara sobre a calha};
  // {-1, -1, 0} se nada na faixa. A lista de sinergias ao lado da coluna tem outro perfil e não passa por moldura.
  public static double[] FindFrame(Bitmap b, double scale, double top, double pitch, double slotH, int count, int xMin, int xMax) {
    int stride; var p = Bytes(b, out stride); int W = b.Width, H = b.Height;
    // Um perfil por espaço; a pontuação é a mediana entre os espaços (itens brilhando junto à borda de 1 a 3 espaços não
    // derrubam a leitura), o contraste vem do perfil médio.
    var profs = new double[count][]; var prof = new double[W]; int used = 0;
    for (int i = 0; i < count; i++) {
      profs[i] = new double[W]; int r0 = (int)Math.Round(top + i * pitch + slotH * 0.18), r1 = (int)Math.Round(top + i * pitch + slotH * 0.82), rows = 0;
      for (int y = r0; y < r1; y++) { if (y < 0 || y >= H) continue; rows++;
        for (int x = 0; x < W; x++) { int k = y * stride + x * 4; profs[i][x] += 0.299 * p[k + 2] + 0.587 * p[k + 1] + 0.114 * p[k]; } }
      if (rows == 0) { profs[i] = null; continue; }
      used++; for (int x = 0; x < W; x++) { profs[i][x] /= rows; prof[x] += profs[i][x]; }
    }
    if (used == 0) return new double[] { -1, -1, 0 };
    for (int x = 0; x < W; x++) prof[x] /= used;
    // Molde por pontos (u em pixels da calibração, valor de luma): a borda esquerda (u de -9 a 3) e a borda direita do
    // mesmo quadro, 45 px adiante (u de 45 a 56); o interior, que muda com o item, fica de fora. Cada ponto cai em round(u x scale).
    int[] us = { -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56 };
    double[] tv = { 23, 23, 23, 23, 23, 23, 23, 23, 23, 11, 27, 36, 34, 17, 34, 36, 27, 11, 23, 23, 23, 23, 23, 23, 23 };
    int n = us.Length; var off = new int[n]; for (int j = 0; j < n; j++) off[j] = (int)Math.Round(us[j] * scale);
    double mt = 0; for (int j = 0; j < n; j++) mt += tv[j]; mt /= n; double vt = 0; for (int j = 0; j < n; j++) vt += (tv[j] - mt) * (tv[j] - mt);
    double[] best = { -1, -1, 0 };
    for (int x = Math.Max(xMin, -off[0]); x <= xMax && x + off[n - 1] < W; x++) {
      var scores = new System.Collections.Generic.List<double>();
      foreach (var pr in profs) { if (pr == null) continue;
        double ms = 0; for (int j = 0; j < n; j++) ms += pr[x + off[j]]; ms /= n;
        double vs = 0, cv = 0; for (int j = 0; j < n; j++) { double d = pr[x + off[j]] - ms; vs += d * d; cv += d * (tv[j] - mt); }
        scores.Add(vs < 1e-6 ? 0 : cv / Math.Sqrt(vs * vt)); }
      scores.Sort(); double ncc = scores[scores.Count / 2];
      if (ncc > best[1]) {
        var v = new double[n]; for (int j = 0; j < n; j++) v[j] = prof[x + off[j]];
        double line = (v[10] + v[11] + v[12] + v[14] + v[15] + v[16]) / 6, gut = 0; for (int j = 0; j < 9; j++) gut += v[j]; gut /= 9;
        best = new[] { (double)(x + (int)Math.Round(2 * scale)), ncc, gut > 0 ? line / gut - 1 : 0 };
      }
    }
    return best;
  }
  // Como Best, mas tolera o espaço 1 a 2 pixels fora do lugar (a moldura já situa a coluna): testa pequenos deslocamentos e
  // fica com o melhor. Deslocamentos grandes davam ao candidato errado muitas chances de parecer certo (o mínimo de dezenas
  // de distâncias ruidosas), e uma região fora do lugar acabava reconhecida como item.
  public static double[] BestShifted(Bitmap b, int x, int y, int w, int h, byte[][] candidates, int[] family) {
    double[] best = { -1, 99, 99 };
    for (int dy = -2; dy <= 2; dy++) for (int dx = -1; dx <= 1; dx++) {
      if (x + dx < 0 || y + dy < 0 || x + dx + w > b.Width || y + dy + h > b.Height) continue;
      var r = Best(Signature(b, x + dx, y + dy, w, h), candidates, family); if (r[1] < best[1]) best = r; }
    return best;
  }
  // {índice do melhor, distância do melhor, distância do segundo}. O segundo é o melhor de OUTRA família: o item e a
  // sua variação radiante têm ícones quase iguais e não contam como concorrentes entre si (vale o item base).
  public static double[] Best(byte[] s, byte[][] candidates, int[] family) {
    int best = -1; double d1 = 99, d2 = 99; var d = new double[candidates.Length];
    for (int i = 0; i < candidates.Length; i++) { d[i] = Match(s, candidates[i]); if (d[i] < d1) { d1 = d[i]; best = i; } }
    if (best >= 0) for (int i = 0; i < candidates.Length; i++) if (family[i] != family[best] && d[i] < d2) d2 = d[i];
    return new[] { (double)best, d1, d2 };
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
$MATCH_MAX = 0.6  # distância (Tft.Match: forma + cor, 0 = idêntico) aceita como o mesmo ícone. Medido na coluna real: itens
                  # certos de 0,14 a 0,51 (escurecido); regiões que NÃO são item (lista de sinergias, vazio) de 0,55 a 0,90
$EMPTY_MAX = 14   # brilho médio de um espaço vazio escuro
$EMPTY_FLAT = 40  # espaço vazio também é liso: brilho médio até este valor e desvio até EMPTY_SPREAD (o fundo atrás do espaço clareia)
$EMPTY_SPREAD = 10
$SAME_ICON = 0.45 # a leitura ainda é o mesmo ícone reconhecido antes (mesma forma e cor, com outro brilho ou realce)
$GAP_MIN = 0.1    # folga mínima entre o 1º candidato e o melhor de outra família (ou razão GAP_RATIO)
$GAP_RATIO = 0.75 # ... o 1º candidato a até 75% da distância do 2º
# Itens raros (artefato, emblema, radiante) quase nunca estão no banco no começo da partida, e foram os falsos positivos
# observados: pedem evidência mais forte. Com a coluna sem moldura confirmada (geometria "assumida") vale o mesmo rigor.
$RARE_MAX = 0.45
$RARE_GAP = 0.15
$RARE_RATIO = 0.6
$RARE_KIND = 'Artifact|Emblem|Radiant'
$FRAME_MIN = 0.75    # correlação mínima da moldura do banco (medida: 0,9 a 1,0 na coluna; 0,3 a 0,5 fora dela)
$FRAME_CONTRAST = 0.2 # contraste mínimo da linha clara da moldura sobre a calha (medido 0,4 a 0,6)

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

# Lê um campo do HUD do recorte já capturado: devolve o texto do OCR e o valor interpretado ($null = não lido).
function Read-Field([string]$field, [System.Drawing.Bitmap]$bitmap) {
  $text = ''; $value = $null
  if ($field -eq 'gold') { $text = Read-Region $bitmap -Tile; $value = Parse-Tiled $text }
  elseif ($field -eq 'level') { $text = Read-Region $bitmap -Tile; $n = Parse-Tiled $text; if ($null -ne $n -and $n -ge 1 -and $n -le 11) { $value = $n } }
  elseif ($field -eq 'stage') { $text = Read-Region $bitmap -Tile; $n = Parse-Tiled $text; if ($null -ne $n -and $n -ge 11 -and $n -le 97 -and $n % 10 -ge 1 -and $n % 10 -le 7) { $value = '' + [Math]::Floor($n / 10) + '-' + ($n % 10) } }
  else { $text = Read-Region $bitmap; if ($text -match '(\d{1,3})\s*/\s*(\d{1,3})') { $value = $Matches[1] + '/' + $Matches[2] } }
  @{ text = $text; value = $value }
}
# O HUD do jogo é desenhado em 16:9 e escalado sem esticar: numa janela mais larga (maximizada com barra de título, tela
# ultrawide) ele ocupa a altura toda e fica centralizado na largura; numa mais alta ocupa a largura toda e fica colado
# embaixo (ou no topo, para o estágio). As frações das regiões valem para esse retângulo, não para a área cliente inteira:
# lido pela área cliente de uma janela 2560x1351, o nível e o XP (longe do centro) saíam 45 px fora do lugar e nunca eram lidos.
function Hud-Rect($client, [string]$anchor) {
  $w = $client[2]; $h = $client[3]
  if ([Math]::Abs($w * 9 - $h * 16) -le $h * 16 * 0.01) { return $client }
  if ($w * 9 -gt $h * 16) { $hw = [int][Math]::Round($h * 16 / 9); return @(($client[0] + [int][Math]::Floor(($w - $hw) / 2)), $client[1], $hw, $h) }
  $hh = [int][Math]::Round($w * 9 / 16); $dy = if ($anchor -eq 'top') { 0 } else { $h - $hh }
  @($client[0], ($client[1] + $dy), $w, $hh)
}

$ids = @(); $signatures = New-Object 'System.Collections.Generic.List[byte[]]'
if ($Candidates -and (Test-Path $Candidates)) {
  foreach ($entry in (Get-Content -Raw -Encoding UTF8 $Candidates | ConvertFrom-Json)) {
    try { $icon = New-Object System.Drawing.Bitmap $entry.file; $signatures.Add([Tft]::Signature($icon, 0, 0, $icon.Width, $icon.Height)); $ids += $entry.id; $icon.Dispose() } catch {}
  }
}
$signatureArray = $signatures.ToArray()
# Família de cada candidato: o item e a variação radiante compartilham o número (ícones quase iguais). O id da radiante vem
# como DA_BrambleVestRadiant e como DA_KrakensFury_Radiant (com sublinhado): as duas formas voltam ao item base.
function Family-Key([string]$id) { $id -replace '_?Radiant', '' }
$familyKeys = @{}; $families = [int[]]::new($ids.Count)
for ($k = 0; $k -lt $ids.Count; $k++) { $fk = Family-Key $ids[$k]; if (-not $familyKeys.ContainsKey($fk)) { $familyKeys[$fk] = $familyKeys.Count }; $families[$k] = $familyKeys[$fk] }
# Classifica um espaço do banco: vazio (''), item reconhecido (id) ou não reconhecido ('?'). Vazio é escuro e liso; o item
# vale se o 1º candidato está perto e se destaca do melhor de outra família (folga fixa ou 20% menor que o 2º).
function Num($x) { if ($null -eq $x) { return $null }; [string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0:0.###}', [double]$x) }
function Classify-Slot($column, [int]$y, [int]$slotH, [bool]$assumed = $false) {
  $sig = [Tft]::Signature($column, 0, $y, $column.Width, $slotH); $mean = [Tft]::Mean($sig); $spread = [Tft]::Spread($sig)
  if ($mean -le $EMPTY_MAX -or ($mean -le $EMPTY_FLAT -and $spread -le $EMPTY_SPREAD)) { return @{ value = ''; id = $null; best = $null; d1 = $null; d2 = $null; mean = $mean; spread = $spread; debug = "slot=vazio media=$mean desvio=$spread" } }
  if (-not $signatureArray.Length) { return @{ value = '?'; id = $null; best = $null; d1 = $null; d2 = $null; mean = $mean; spread = $spread; debug = "slot=? sem candidatos" } }
  $best = [Tft]::BestShifted($column, 0, $y, $column.Width, $slotH, $signatureArray, $families)
  $bi = [int]$best[0]; $name = if ($bi -ge 0) { $ids[$bi] } else { $null }
  $strict = $assumed -or ($name -match $RARE_KIND)
  $max = if ($strict) { $RARE_MAX } else { $MATCH_MAX }; $gap = if ($strict) { $RARE_GAP } else { $GAP_MIN }; $ratio = if ($strict) { $RARE_RATIO } else { $GAP_RATIO }
  $ok = $bi -ge 0 -and $best[1] -le $max -and ($best[2] - $best[1] -ge $gap -or $best[1] -le $ratio * $best[2])
  $found = if ($ok) { $name } else { $null }
  @{ value = $(if ($ok) { $found } else { '?' }); id = $found; best = $name; d1 = $best[1]; d2 = $best[2]; mean = $mean; spread = $spread; debug = "slot=$name d=$([math]::Round($best[1], 3)) segundo=$([math]::Round($best[2], 3)) media=$mean desvio=$spread" }
}

$testBitmap = $null
if ($TestImage) { $testBitmap = New-Object System.Drawing.Bitmap $TestImage }
function Grab-Px([int]$rx, [int]$ry, [int]$rw, [int]$rh) {
  $bitmap = New-Object System.Drawing.Bitmap $rw, $rh; $g = [System.Drawing.Graphics]::FromImage($bitmap)
  if ($testBitmap) { $g.DrawImage($testBitmap, (New-Object System.Drawing.Rectangle 0, 0, $rw, $rh), (New-Object System.Drawing.Rectangle $rx, $ry, $rw, $rh), 'Pixel') }
  else { $g.CopyFromScreen($rx, $ry, 0, 0, $bitmap.Size) }
  $g.Dispose(); $bitmap
}
function Grab($client, $region, $y, $h) {
  Grab-Px ([int]($client[0] + $client[2] * $region.X)) ([int]($client[1] + $client[3] * $y)) ([Math]::Max(8, [int]($client[2] * $region.W))) ([Math]::Max(8, [int]($client[3] * $h)))
}
# O centro da região mostra o jogo (outra janela por cima seria lida no lugar dele). -TestImage não tem janela.
function Shown($client, $region, $y, $h) {
  if ($testBitmap) { return $true }
  [Tft]::Shows([int]($client[0] + $client[2] * ($region.X + $region.W / 2)), [int]($client[1] + $client[3] * ($y + $h / 2)))
}
# Acha a coluna do banco pela moldura dos espaços (ver Tft.FindFrame), em vez de supor onde ela está: o HUD é 16:9 e escalado
# pela altura, mas a coluna fica na borda esquerda da janela e não necessariamente no retângulo 16:9 centralizado (numa janela
# 2560x1351 as duas posições diferem 79 px, e a lista de sinergias ao lado da coluna virava "item" reconhecido).
# Devolve @{ ok; x (início do interior do 1º espaço, em px da tela); ncc; contrast }.
function Locate-Column($client, $hud) {
  $H = $hud[3]; $s = $H / 1149.0; $pw = [int][Math]::Round($H * 16 / 9)
  $top = $hud[1] + $SLOT.Y * $H; $pitch = $SLOT.Pitch * $H; $slotH = $SLOT.H * $H
  $xMax = $hud[0] + $SLOT.X * $pw + 40 * $s
  $sx = [int]$client[0]; $sw = [int][Math]::Min($client[2] - 1, ($xMax - $sx) + 62 * $s)
  $sy = [int]($top - 8 * $s); $sh = [int](9 * $pitch + $slotH + 16 * $s)
  if ($sw -lt 80 -or $sh -lt 80) { return @{ ok = $false; x = -1; ncc = -1; contrast = 0 } }
  # Outra janela por cima da borda esquerda do jogo: não há o que medir (não conta como "sem moldura").
  if (-not $testBitmap -and -not [Tft]::Shows([int]($sx + 30 * $s), [int]($top + 5 * $pitch))) { return @{ ok = $false; covered = $true; x = -1; ncc = -1; contrast = 0 } }
  $strip = Grab-Px $sx $sy $sw $sh
  $r = [Tft]::FindFrame($strip, $s, ($top - $sy), $pitch, $slotH, $SLOT.Count, 0, [int]($xMax - $sx)); $strip.Dispose()
  $ok = $r[0] -ge 0 -and $r[1] -ge $FRAME_MIN -and $r[2] -ge $FRAME_CONTRAST
  @{ ok = $ok; x = [int]($sx + $r[0]); ncc = $r[1]; contrast = $r[2] }
}
$md5 = [System.Security.Cryptography.MD5]::Create()
function Hash([System.Drawing.Bitmap]$bitmap) { $stride = 0; [BitConverter]::ToString($md5.ComputeHash([Tft]::Bytes($bitmap, [ref]$stride))) }

$removerSlots = @{}; $tick = 0; $cardLines = @()
$state = @{ window = $false; removers = $null; stage = $null; gold = $null; level = $null; xp = $null; items = @(); unknownItems = 0; shop = @('', '', '', '', '') }
$hashes = @{}; $slotSignatures = @{}; $slotValues = @{}; $lastLine = ''; $baseOf = @{}; $lastClientKey = ''; $slotGeo = $null; $frameMiss = 0; $slotKnown = @{}; $slotDebug = @{}
while ($true) {
  $debug = @()
  try {
    $client = if ($TestImage) { $TestClient -split ',' | ForEach-Object { [int]$_ } } else { [Tft]::Client() }
    if (-not $client) { $state.window = $false }
    else {
      $state.window = $true
      # Janela redimensionada: as posições mudam, então recortes, assinaturas e a base que funcionava são descartados.
      $clientKey = $client -join ','
      if ($clientKey -ne $lastClientKey) { $lastClientKey = $clientKey; $hashes = @{}; $slotSignatures = @{}; $baseOf = @{}; $slotGeo = $null; $frameMiss = 0; $slotKnown = @{}; $slotDebug = @{}; $lastLine = '' }
      $hudBottom = Hud-Rect $client 'bottom'; $hudTop = Hud-Rect $client 'top'
      foreach ($field in 'gold', 'level', 'xp', 'stage') {
        $region = @{ gold = $GOLD; level = $LEVEL; xp = $XP; stage = $STAGE }[$field]
        $hudField = if ($field -eq 'stage') { $hudTop } else { $hudBottom }
        # Onde o recorte pode estar: o retângulo 16:9 do HUD e, se a janela não é 16:9, a área cliente inteira (reserva
        # para um layout que não escale assim). Enquanto o campo nunca foi lido tenta as duas; depois do primeiro acerto, só a que acertou.
        $bases = @(, $hudField); if (($hudField -join ',') -ne $clientKey) { $bases += , $client }
        $order = if ($baseOf.ContainsKey($field)) { @($baseOf[$field]) } else { 0..($bases.Count - 1) }
        $anyShown = $false
        foreach ($b in $order) {
          $base = $bases[$b]
          # Coberto por outra janela: não lido (o .mjs mantém o último valor e o marca como velho) e relido ao descobrir.
          if (-not (Shown $base $region $region.Y $region.H)) { continue }
          $anyShown = $true
          $bitmap = Grab $base $region $region.Y $region.H; $hash = Hash $bitmap; $key = "$field#$b"
          if ($hashes[$key] -ne $hash) {
            $hashes[$key] = $hash
            $read = Read-Field $field $bitmap
            $state[$field] = $read.value
            $debug += "$field@$b='$($read.text)'"
            # Leitura falhou (painel por cima, número em transição): relê no próximo laço mesmo sem o recorte mudar.
            if ($null -eq $read.value) { $hashes[$key] = $null }
          }
          $bitmap.Dispose()
          if ($null -ne $state[$field]) { $baseOf[$field] = $b; break }
        }
        if (-not $anyShown) { $state[$field] = $null; $hashes["$field#0"] = $null; $hashes["$field#1"] = $null }
      }
      # Cards de escolha: OCR da faixa central, só em rodadas iniciais do estágio (ou estágio não lido) e em laços alternados.
      $tick++; $round = if ($state.stage) { [int]$state.stage.Substring(2) } else { 0 }
      if ($round -le 2 -and (Shown $hudBottom $BAND $BAND.Y $BAND.H)) { if ($tick % 2 -eq 0 -or $TestImage) { $wide = Grab $hudBottom $BAND $BAND.Y $BAND.H; $cardLines = @(Recognize $wide -Lines | Where-Object { $_ -and $_.Length -ge 4 } | Select-Object -First 40 | ForEach-Object { [string]$_ }); $wide.Dispose() } } else { $cardLines = @() }
      # Loja: o nome de cada carta é texto; carta vazia (comprada) não tem pixels claros e vira ''.
      for ($i = 0; $i -lt $SHOP.Count; $i++) {
        $card = @{ X = $SHOP.X + $SHOP.Pitch * $i; W = $SHOP.W }
        if (-not (Shown $hudBottom $card $SHOP.Y $SHOP.H)) { continue } # coberta: mantém a última leitura
        $bitmap = Grab $hudBottom $card $SHOP.Y $SHOP.H; $hash = Hash $bitmap
        if ($hashes["shop$i"] -ne $hash) { $hashes["shop$i"] = $hash; $text = (Read-Region $bitmap).Trim(); $state.shop[$i] = $text; $debug += "shop$i='$text'" }
        $bitmap.Dispose()
      }
      # Banco de itens: uma captura da coluna inteira; cada espaço só é reclassificado quando muda.
      # Onde a coluna está vem da moldura dos espaços (Locate-Column), a cada laço. Sem moldura confirmada (3 laços seguidos),
      # supõe o retângulo 16:9 do HUD ("assumida") e só aceita item com evidência forte: é melhor "?" do que um item errado.
      $loc = Locate-Column $client $hudBottom
      $hudW = [int][Math]::Round($hudBottom[3] * 16 / 9)
      if ($loc.ok) {
        $frameMiss = 0
        $rect = @(($loc.x - [int][Math]::Round($SLOT.X * $hudW)), $hudBottom[1], $hudW, $hudBottom[3])
        # Só reposiciona se a coluna andou mais que o jitter de 2 px (ou se estava assumida): memória e assinaturas dos espaços perdem o sentido.
        if ($slotGeo -and $slotGeo.mode -eq 'frame' -and [Math]::Abs($slotGeo.rect[0] - $rect[0]) -le 2 -and $slotGeo.rect[3] -eq $rect[3]) { $rect = $slotGeo.rect } else { $slotSignatures = @{}; $slotKnown = @{} }
        $slotGeo = @{ mode = 'frame'; rect = $rect }
      } else {
        if (-not $loc.covered) { $frameMiss++ }
        if (-not $slotGeo -or ($slotGeo.mode -eq 'frame' -and $frameMiss -ge 3)) { $slotGeo = @{ mode = 'assumed'; rect = $hudBottom }; $slotSignatures = @{}; $slotKnown = @{} }
      }
      $assumed = $slotGeo.mode -ne 'frame'
      $state.bankGeo = @{ mode = $slotGeo.mode; x = [int]($slotGeo.rect[0] + [Math]::Round($SLOT.X * $slotGeo.rect[2])); ncc = (Num $loc.ncc); contrast = (Num $loc.contrast); client = $clientKey }
      $slotRect = $slotGeo.rect
      $column = Grab $slotRect $SLOT $SLOT.Y ($SLOT.Pitch * ($SLOT.Count - 1) + $SLOT.H)
      $slotH = [int]($slotRect[3] * $SLOT.H)
      for ($i = 0; $i -lt $SLOT.Count; $i++) {
        if (-not (Shown $slotRect $SLOT ($SLOT.Y + $SLOT.Pitch * $i) $SLOT.H)) { continue } # coberto: mantém o último valor
        $sy = [int]($slotRect[3] * $SLOT.Pitch * $i)
        $signature = [Tft]::Signature($column, 0, $sy, $column.Width, $slotH)
        if ($slotSignatures[$i] -and [Tft]::Distance($signature, $slotSignatures[$i]) -lt 4) { continue }
        $slotSignatures[$i] = $signature
        $removerSlots.Remove($i)
        $c = Classify-Slot $column $sy $slotH $assumed
        # Não reconhecido agora, mas é o mesmo ícone que já foi reconhecido neste espaço (realce do mouse, tela escurecida
        # por um painel, brilho que mudou): mantém o item em vez de piscar "?".
        $kept = $false
        if ($c.value -eq '?' -and $slotKnown.ContainsKey($i) -and [Tft]::Match($signature, $slotKnown[$i].sig) -le $SAME_ICON) {
          $kept = $true
          $c = @{ value = $slotKnown[$i].id; id = $slotKnown[$i].id; best = $c.best; d1 = $c.d1; d2 = $c.d2; mean = $c.mean; spread = $c.spread; debug = "slot=$($slotKnown[$i].id) mantido (mesmo ícone de antes; $($c.debug))" }
        }
        elseif ($c.id) { $slotKnown[$i] = @{ sig = $signature; id = $c.id } }
        elseif ($c.value -eq '') { $slotKnown.Remove($i) }
        $slotValues[$i] = $c.value
        # Diagnóstico ao vivo (sem imagem): por que o espaço virou o que virou. best/d1/d2 = melhor candidato, sua distância e a do
        # melhor de outra família; kept = valor mantido pela memória do espaço.
        $slotDebug[$i] = @{ slot = $i; value = $c.value; best = $c.best; d1 = (Num $c.d1); d2 = (Num $c.d2); mean = $c.mean; spread = $c.spread; kept = $kept }
        $debug += $c.debug
        # Removedor empilha: o número no canto superior esquerdo do ícone é a quantidade.
        if ($slotValues[$i] -match 'ItemRemover') {
          $bw = [int]($column.Width * 0.44); $bh = [int]($slotH * 0.44); $badge = $column.Clone((New-Object System.Drawing.Rectangle 0, $sy, $bw, $bh), $column.PixelFormat)
          $badgeText = Read-Region $badge -Tile -Whole; $count = Parse-Tiled $badgeText; $debug += "selo='$badgeText'"; $badge.Dispose(); $removerSlots[$i] = if ($null -ne $count -and $count -ge 1 -and $count -le 99) { $count } else { 1 }; $debug += "slot$i removedores=$($removerSlots[$i])"
        }
      }
      $column.Dispose()
      $state.items = @(0..($SLOT.Count - 1) | ForEach-Object { $slotValues[$_] } | Where-Object { $_ -and $_ -ne '?' })
      $state.unknownItems = @(0..($SLOT.Count - 1) | Where-Object { $slotValues[$_] -eq '?' }).Count
      $state.removers = ($removerSlots.Values | Measure-Object -Sum).Sum; if ($null -eq $state.removers) { $state.removers = 0 }
    }
    $line = (@{ window = $state.window; removers = $state.removers; stage = $state.stage; gold = $state.gold; level = $state.level; xp = $state.xp; items = @($state.items); unknownItems = $state.unknownItems; bankDebug = @(0..($SLOT.Count - 1) | Where-Object { $slotDebug[$_] } | ForEach-Object { $slotDebug[$_] }); bankGeo = $state.bankGeo; shop = @($state.shop); band = @($cardLines) } | ConvertTo-Json -Compress -Depth 6)
    if ($line -ne $lastLine) { $lastLine = $line; [Console]::Out.WriteLine($line) }
    if ($TestImage) { $debug | ForEach-Object { [Console]::Out.WriteLine($_) } }
  } catch {
    # Leitura interrompida: relê todos os recortes no próximo laço (o hash pode ter sido gravado sem a leitura)
    # e reemite a próxima linha boa mesmo igual à anterior, para o .mjs limpar o erro.
    $hashes = @{}; $slotSignatures = @{}; $lastLine = ''
    [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress))
  }
  if ($TestImage) { break }
  if ($ParentPid -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds $IntervalMs
}
