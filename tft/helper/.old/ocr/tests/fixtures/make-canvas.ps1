# Monta uma "tela" de teste para o screen-reader.ps1 (-TestImage) a partir de uma faixa REAL do banco de itens (calibração
# 2044x1149), sem captura de tela: a faixa é escalada e posta numa janela de Width x Height. Em escala 1 e janela 16:9 é a
# própria calibração; numa janela mais larga a coluna cai onde -StripX manda (esquerda da janela, ou no retângulo 16:9 centralizado).
param(
  [string]$Strip,        # PNG da faixa (x 256..456, y 380..956 da calibração: a coluna começa em x=14, y=14 da faixa)
  [string]$Out,
  [int]$Width = 2044,
  [int]$Height = 1149,
  [double]$StripX = 0,   # onde a origem da faixa cai na janela, em pixels da janela (já na escala final)
  [double]$Dim = 1       # brilho (simula o jogo escurecido)
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$src = New-Object System.Drawing.Bitmap $Strip
$scale = $Height / 1149.0
$canvas = New-Object System.Drawing.Bitmap $Width, $Height
$g = [System.Drawing.Graphics]::FromImage($canvas); $g.Clear([System.Drawing.Color]::FromArgb(40, 30, 30))
$g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'Half'
# a coluna começa em y = 0,24374 x Height; na faixa ela está 14 px (da calibração) abaixo do topo
$y = 0.24374 * $Height - 14 * $scale
$g.DrawImage($src, (New-Object System.Drawing.RectangleF ([single]$StripX), ([single]$y), ([single]($src.Width * $scale)), ([single]($src.Height * $scale))), (New-Object System.Drawing.RectangleF 0, 0, $src.Width, $src.Height), 'Pixel')
$g.Dispose(); $src.Dispose()
if ($Dim -ne 1) {
  $o = New-Object System.Drawing.Bitmap $Width, $Height; $cm = New-Object System.Drawing.Imaging.ColorMatrix; $cm.Matrix00 = $Dim; $cm.Matrix11 = $Dim; $cm.Matrix22 = $Dim
  $ia = New-Object System.Drawing.Imaging.ImageAttributes; $ia.SetColorMatrix($cm); $g2 = [System.Drawing.Graphics]::FromImage($o)
  $g2.DrawImage($canvas, (New-Object System.Drawing.Rectangle 0, 0, $Width, $Height), 0, 0, $Width, $Height, 'Pixel', $ia); $g2.Dispose(); $canvas.Dispose(); $canvas = $o
}
$canvas.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $canvas.Dispose()
