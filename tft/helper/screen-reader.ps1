# Lê da janela do TFT, sem tocar no processo do jogo: ouro, nível, XP e estágio (por glifo, com gabaritos gravados em
# screen-glyphs.json), o banco de itens (grade dos espaços medida na imagem e comparação com os ícones do catálogo) e os nomes
# da loja (OCR nativo do Windows). Só captura pixels da tela e a posição da janela.
# Leve por construção: um processo persistente, recortes pequenos, e cada leitura só roda quando seu recorte muda.
# Requer Windows PowerShell 5.1 (powershell.exe); o PowerShell 7 não projeta tipos WinRT.
param(
  [string]$Candidates = '',   # JSON [{id,file}] com os ícones de item a comparar
  [int]$IntervalMs = 2500,
  [int]$ParentPid = 0,        # encerra sozinho quando o servidor que o iniciou deixa de existir
  [string]$FullPng = '',      # grava uma captura da tela principal inteira e sai (calibração)
  [string]$TestImage = '',    # usa um arquivo como se fosse a tela, faz uma leitura com diagnóstico e sai
  [string]$TestClient = '',   # "x,y,largura,altura" da área cliente do jogo dentro de -TestImage
  [switch]$Dump,              # com -TestManifest: inclui os glifos de cada campo (vetores), para montar os gabaritos (scripts/screen-glyphs.mjs)
  [string]$TestManifest = ''  # JSON [{id,image,client}]: uma leitura por quadro (cada um a frio), uma linha JSON por quadro, e sai (relatório de precisão)
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
// Leitura de texto do HUD por glifo (sem OCR): binariza o recorte (Otsu), separa os glifos por componentes conectados e compara
// cada um, normalizado pela altura da linha, com os gabaritos gravados em screen-glyphs.json (um conjunto por campo: ouro, nível,
// XP, estágio, selo de quantidade). Determinístico, sem dependência do idioma do Windows e sem tarefa assíncrona.
public static class Glyph {
  public const int GW = 12, GH = 16, N = GW * GH;
  public class Part { public int Id, X, Y, W, H, Area; public bool Edge; public double[] V; public char Ch = '?'; public double D1 = 99, D2 = 99; }
  public class Result { public string Text = ""; public double Worst = 99; public double Contrast; public int Threshold; public int LineTop, LineBottom; public System.Collections.Generic.List<Part> Parts = new System.Collections.Generic.List<Part>(); }
  class Tmpl { public char C; public double[] V; }
  static System.Collections.Generic.Dictionary<string, System.Collections.Generic.List<Tmpl>> sets = new System.Collections.Generic.Dictionary<string, System.Collections.Generic.List<Tmpl>>();
  public static void Clear() { sets.Clear(); }
  // Um gabarito: vetor GW x GH em bytes (0..255) codificado em base64.
  public static void Add(string set, char c, string b64) {
    var raw = System.Convert.FromBase64String(b64); if (raw.Length != N) return;
    var v = new double[N]; for (int i = 0; i < N; i++) v[i] = raw[i] / 255.0;
    if (!sets.ContainsKey(set)) sets[set] = new System.Collections.Generic.List<Tmpl>();
    sets[set].Add(new Tmpl { C = c, V = v });
  }
  public static int Count(string set) { return sets.ContainsKey(set) ? sets[set].Count : 0; }
  public static string Encode(double[] v) { var raw = new byte[N]; for (int i = 0; i < N; i++) raw[i] = (byte)System.Math.Max(0, System.Math.Min(255, (int)System.Math.Round(v[i] * 255))); return System.Convert.ToBase64String(raw); }
  static double Sample(float[] L, int w, int h, double x, double y) {
    x -= 0.5; y -= 0.5; int x0 = (int)System.Math.Floor(x), y0 = (int)System.Math.Floor(y); double fx = x - x0, fy = y - y0;
    int xa = System.Math.Max(0, System.Math.Min(w - 1, x0)), xb = System.Math.Max(0, System.Math.Min(w - 1, x0 + 1)), ya = System.Math.Max(0, System.Math.Min(h - 1, y0)), yb = System.Math.Max(0, System.Math.Min(h - 1, y0 + 1));
    return (L[ya * w + xa] * (1 - fx) + L[ya * w + xb] * fx) * (1 - fy) + (L[yb * w + xa] * (1 - fx) + L[yb * w + xb] * fx) * fy;
  }
  // Forma do glifo: grade GW x GH que cobre a altura da linha (top..top+lineH), com o glifo centrado em cx e na proporção
  // original (a largura não é esticada: o "1" continua estreito); fora da caixa do próprio glifo vale o fundo (o vizinho não
// contamina). Valores normalizados entre o fundo (lo) e a tinta (hi).
  static double[] Shape(float[] L, int w, int h, double cx, double top, double lineH, double lo, double hi, double gx0, double gx1) {
    var v = new double[N]; double sc = GH / lineH, cell = 1.0 / sc; double span = hi - lo; if (span < 1) span = 1;
    for (int r = 0; r < GH; r++) for (int c = 0; c < GW; c++) {
      double sum = 0; for (int sy = 0; sy < 3; sy++) for (int sx = 0; sx < 3; sx++) {
        double x = cx + (c + (sx + 0.5) / 3.0 - GW / 2.0) * cell, y = top + (r + (sy + 0.5) / 3.0) * cell;
        sum += (x < gx0 || x > gx1) ? lo : Sample(L, w, h, System.Math.Max(gx0, System.Math.Min(gx1, x)), y); }
      double val = (sum / 9.0 - lo) / span; v[r * GW + c] = val < 0 ? 0 : val > 1 ? 1 : val;
    }
    return v;
  }
  static int Otsu(int[] hist, int total) {
    double sum = 0; for (int i = 0; i < 256; i++) sum += i * hist[i];
    double sb = 0, best = -1; int wb = 0, t = 128;
    for (int i = 0; i < 256; i++) { wb += hist[i]; if (wb == 0) continue; int wf = total - wb; if (wf == 0) break; sb += i * hist[i];
      double mb = sb / wb, mf = (sum - sb) / wf, between = (double)wb * wf * (mb - mf) * (mb - mf); if (between > best) { best = between; t = i; } }
    return t;
  }
  // Segmenta o recorte em glifos. `invert`: texto escuro sobre fundo claro (selo de quantidade, que é amarelo com número escuro).
  // `tscale` < 1 baixa o limiar (traços finos de 720p ficam abertos no anel do 0 e separam o glifo em dois pedaços).
  public static Result Scan(System.Drawing.Bitmap b, bool invert, double minContrast, double tscale) {
    var res = new Result(); int stride; var p = Tft.Bytes(b, out stride); int w = b.Width, h = b.Height;
    var L = new float[w * h]; var hist = new int[256];
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) { int i = y * stride + x * 4; double l = 0.299 * p[i + 2] + 0.587 * p[i + 1] + 0.114 * p[i]; if (invert) l = 255 - l; L[y * w + x] = (float)l; hist[(int)l]++; }
    int t = (int)(Otsu(hist, w * h) * tscale); res.Threshold = t;
    double sf = 0, sbg = 0; int nf = 0, nb = 0; for (int i = 0; i < w * h; i++) { if (L[i] > t) { sf += L[i]; nf++; } else { sbg += L[i]; nb++; } }
    if (nf == 0 || nb == 0) return res; double mf = sf / nf, mbg = sbg / nb; res.Contrast = mf - mbg; if (res.Contrast < minContrast) return res;
    // componentes conectados (8 vizinhos) do que passa do limiar
    var lab = new int[w * h]; var stack = new System.Collections.Generic.Stack<int>(); var all = new System.Collections.Generic.List<Part>(); int id = 0;
    for (int s = 0; s < w * h; s++) {
      if (L[s] <= t || lab[s] != 0) continue; id++; int x0 = w, y0 = h, x1 = -1, y1 = -1, area = 0; stack.Push(s); lab[s] = id;
      while (stack.Count > 0) { int q = stack.Pop(); int qx = q % w, qy = q / w; area++; if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
        for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) { int nx = qx + dx, ny = qy + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; int ni = ny * w + nx; if (L[ni] > t && lab[ni] == 0) { lab[ni] = id; stack.Push(ni); } } }
      all.Add(new Part { Id = id, X = x0, Y = y0, W = x1 - x0 + 1, H = y1 - y0 + 1, Area = area, Edge = x0 == 0 || y0 == 0 || x1 == w - 1 || y1 == h - 1 });
    }
    // Componentes cortados pelo lado esquerdo ou direito do recorte são vizinhos (moeda, moldura), não texto.
    all.RemoveAll(c => c.X == 0 || c.X + c.W == w);
    int maxH = 0; foreach (var c in all) if (c.Area >= 3 && !(c.Edge && c.H >= h - 1) && c.H > maxH) maxH = c.H;
    if (maxH < 5) return res;
    // Os glifos altos definem a linha; componentes baixos (hífen, pontos) ficam como candidatos a "-".
    int top = h, bot = -1; var tall = new System.Collections.Generic.List<Part>(); var small = new System.Collections.Generic.List<Part>();
    foreach (var c in all) { if (c.Area < 3 || (c.Edge && c.H >= h - 1)) continue; if (c.H >= 0.6 * maxH) { tall.Add(c); if (c.Y < top) top = c.Y; if (c.Y + c.H > bot) bot = c.Y + c.H; } else small.Add(c); }
    if (tall.Count == 0) return res;
    // Dois dígitos colados: um componente bem mais largo que alto parte-se no vale da projeção vertical.
    var parts = new System.Collections.Generic.List<Part>();
    foreach (var c in tall) {
      if (c.W > 0.95 * (bot - top) && c.W >= 8) {
        int cut = -1, least = int.MaxValue;
        for (int x = c.X + (int)(c.W * 0.3); x <= c.X + (int)(c.W * 0.7); x++) { int cnt = 0; for (int y = c.Y; y < c.Y + c.H; y++) if (lab[y * w + x] == c.Id) cnt++; if (cnt < least) { least = cnt; cut = x; } }
        if (cut > 0) { parts.Add(new Part { Id = c.Id, X = c.X, Y = c.Y, W = cut - c.X, H = c.H, Area = c.Area / 2 }); parts.Add(new Part { Id = c.Id, X = cut + 1, Y = c.Y, W = c.X + c.W - cut - 1, H = c.H, Area = c.Area / 2 }); continue; }
      }
      parts.Add(c);
    }
    double lh = bot - top;
    foreach (var c in small) { double cy = c.Y + c.H / 2.0; if (c.W >= 0.3 * lh && c.H <= 0.34 * lh && cy > top + 0.35 * lh && cy < top + 0.75 * lh) { c.Ch = '-'; parts.Add(c); } }
    parts.Sort((a, c) => a.X.CompareTo(c.X));
    res.LineTop = top; res.LineBottom = bot;
    foreach (var c in parts) {
      if (c.Ch == '-') continue;
      // tinta: percentil alto dos pixels do glifo; fundo: média do que ficou abaixo do limiar
      var vals = new System.Collections.Generic.List<float>(); for (int y = c.Y; y < c.Y + c.H; y++) for (int x = c.X; x < c.X + c.W; x++) vals.Add(L[y * w + x]); vals.Sort();
      double hi = vals[(int)(vals.Count * 0.9)]; if (hi - mbg < 8) hi = mbg + 8;
      c.V = Shape(L, w, h, c.X + c.W / 2.0, top, lh, mbg, hi, c.X - 0.5, c.X + c.W + 0.5);
    }
    res.Parts = parts; return res;
  }
  static double Dist(double[] a, double[] b) { double s = 0; for (int i = 0; i < N; i++) { double d = a[i] - b[i]; s += d * d; } return System.Math.Sqrt(s / N); }
  // Classifica um glifo no conjunto: o caractere do gabarito mais próximo (d1) e a distância do melhor de OUTRO caractere (d2).
  public static void Classify(Part part, string set) {
    part.Ch = '?'; part.D1 = 99; part.D2 = 99; if (part.V == null || !sets.ContainsKey(set)) return;
    char best = '?'; double d1 = 99; foreach (var t in sets[set]) { double d = Dist(part.V, t.V); if (d < d1) { d1 = d; best = t.C; } }
    double d2 = 99; foreach (var t in sets[set]) if (t.C != best) { double d = Dist(part.V, t.V); if (d < d2) d2 = d; }
    part.Ch = best; part.D1 = d1; part.D2 = d2;
  }
  // Lê o recorte como texto do conjunto: cada glifo vira o caractere do gabarito mais próximo se a distância ≤ maxD e a folga
  // para o 2º caractere é ≥ gap (ou d1 ≤ 70% de d2); senão '?'. Hífens (componentes baixos e largos no meio da linha) saem como '-'.
  public static Result Read(System.Drawing.Bitmap b, string set, bool invert, double minContrast, double maxD, double gap, double tscale) {
    var r = Scan(b, invert, minContrast, tscale); var sb = new System.Text.StringBuilder(); double worst = 0;
    foreach (var c in r.Parts) {
      if (c.Ch != '-') { Classify(c, set); bool ok = c.D1 <= maxD && (c.D2 - c.D1 >= gap || c.D1 <= 0.7 * c.D2); if (!ok) c.Ch = '?'; if (c.D1 > worst) worst = c.D1; }
      sb.Append(c.Ch);
    }
    r.Text = sb.ToString(); r.Worst = r.Parts.Count == 0 ? 99 : worst; return r;
  }
}
// Geometria do banco de itens medida na própria imagem. O HUD não escala linearmente com a altura da janela (o passo entre os
// espaços é 36 px em 720p e 56 px em 1149p, e muda com o idioma/ajuste de interface), então as frações medidas numa captura só
// valem naquela captura. A coluna é uma fila de quadros iguais com borda clara fina: o topo de cada quadro é uma subida brusca de
// brilho que se estende por toda a largura do espaço, e as bordas laterais são subidas verticais. Acha-se a grade (primeiro
// topo, passo) que melhor encaixa nas 10 subidas e, com ela, as colunas das bordas esquerda e direita.
public static class Bank {
  // Devolve {ok, xL, xR, y0, pitch, slotH, hits, edge} em pixels da faixa. ok = 1 se pelo menos minHits topos de espaço baterem
  // e as bordas laterais forem nítidas; senão 0 (a leitura cai na geometria suposta).
  public static double[] Lattice(System.Drawing.Bitmap b, int count, double pMin, double pMax, double y0Min, double y0Max, double xMaxL, int minHits) {
    int stride; var px = Tft.Bytes(b, out stride); int W = b.Width, H = b.Height;
    var L = new float[W * H]; for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) { int i = y * stride + x * 4; L[y * W + x] = (float)(0.299 * px[i + 2] + 0.587 * px[i + 1] + 0.114 * px[i]); }
    int xLimit = System.Math.Min(W, (int)(xMaxL + 1.25 * pMax));
    // F(y): a maior sequência (com folga de 1 coluna) de subidas bruscas do brilho para a borda: o topo de um espaço tem a largura dele inteira
    var F = new double[H]; for (int y = 1; y < H; y++) { int run = 0, gap = 0, mx = 0; for (int x = 0; x < xLimit; x++) { bool up = L[y * W + x] - L[(y - 1) * W + x] > 18 && L[y * W + x] > 35; if (up) { run += 1 + gap; gap = 0; if (run > mx) mx = run; } else if (run > 0 && gap == 0) gap = 1; else { run = 0; gap = 0; } } F[y] = mx; }
    var Fs = new double[H]; for (int y = 0; y < H; y++) { double m = F[y]; for (int d = -2; d <= 2; d++) if (y + d >= 0 && y + d < H && F[y + d] > m) m = F[y + d]; Fs[y] = m; }
    double best = -1, bp = 0; int by = 0;
    for (double pitch = pMin; pitch <= pMax; pitch += 0.05) for (int y0 = (int)y0Min; y0 <= y0Max; y0++) {
      // o topo e a borda de baixo (0,83 do passo adiante): sem o segundo termo a grade encaixaria também nas bordas de baixo, que são
      // subidas iguais; a borda de baixo de um espaço fica 0,17 do passo antes do topo do próximo, e só a grade certa tem os dois
      double sum = 0, cap = 0.6 * pitch; for (int k = 0; k < count; k++) { int y = (int)System.Math.Round(y0 + k * pitch), yb = (int)System.Math.Round(y0 + k * pitch + 0.83 * pitch); if (yb >= H) { sum = -1; break; } sum += System.Math.Min(Fs[y], cap) + System.Math.Min(Fs[yb], cap); }
      if (sum > best) { best = sum; bp = pitch; by = y0; }
    }
    var fail = new double[] { 0, -1, -1, -1, -1, -1, 0, 0 };
    if (best <= 0) return fail;
    // espaço "achado": o topo ou a borda de baixo dele aparece (numa tela escurecida o topo dos espaços vazios some, mas a borda de baixo fica)
    int hits = 0; double minCols = 0.3 * pMin * 0.78; for (int k = 0; k < count; k++) if (System.Math.Max(Fs[(int)System.Math.Round(by + k * bp)], Fs[System.Math.Min(H - 1, (int)System.Math.Round(by + k * bp + 0.83 * bp))]) >= minCols) hits++;
    double slotH = 0.83 * bp;
    // bordas laterais: subida vertical de brilho somada nas linhas de dentro dos espaços
    var Hx = new double[W]; for (int k = 0; k < count; k++) { int top = (int)System.Math.Round(by + k * bp); for (int y = top + 4; y < top + (int)slotH - 3 && y < H; y++) for (int x = 1; x < W; x++) { double d = L[y * W + x] - L[y * W + x - 1] - 6; if (d > 0) Hx[x] += d; } }
    // bordas laterais: o par de subidas verticais separado por ~0,78 do passo (a lista de sinergias ao lado tem bordas próprias, mas sem esse par)
    int xEnd = System.Math.Min(W - 2, (int)xMaxL), xL = 1, xR = 1; double bestPair = -1, hl = 0, hr = 0;
    var pairs = new System.Collections.Generic.List<double[]>();
    for (int x = 2; x <= xEnd; x++) {
      if (Hx[x] < Hx[x - 1] || Hx[x] < Hx[x + 1]) continue;
      int r0 = (int)System.Math.Round(x + 0.72 * bp), r1 = System.Math.Min(W - 2, (int)System.Math.Round(x + 0.84 * bp)); double rv = -1; int rx = r0;
      for (int q = r0; q <= r1; q++) if (Hx[q] > rv) { rv = Hx[q]; rx = q; }
      double both = System.Math.Min(Hx[x], rv); pairs.Add(new double[] { x, rx, Hx[x], rv, both }); if (both > bestPair) bestPair = both;
    }
    foreach (var pr in pairs) if (pr[4] >= 0.6 * bestPair) { xL = (int)pr[0]; xR = (int)pr[1]; hl = pr[2]; hr = pr[3]; break; }
    double rows = count * (slotH - 7); double edge = rows > 0 ? hl / (rows * 60.0) : 0, edgeR = rows > 0 ? hr / (rows * 60.0) : 0;
    bool ok = hits >= minHits && edge >= 0.05 && edgeR >= 0.03 && xL >= 0.12 * bp; // a coluna fica a uns 0,2 passos da borda esquerda da janela, nunca colada nela
    return new double[] { ok ? 1 : 0, xL, xR, by, bp, slotH, hits, System.Math.Min(edge, edgeR) };
  }
  // Caixa do selo de quantidade (amarelo, com o número escuro) dentro do recorte: {x, y, largura, altura} ou null.
  public static int[] YellowBox(System.Drawing.Bitmap b) {
    int stride; var px = Tft.Bytes(b, out stride); int x0 = b.Width, y0 = b.Height, x1 = -1, y1 = -1, n = 0;
    for (int y = 0; y < b.Height; y++) for (int x = 0; x < b.Width; x++) { int i = y * stride + x * 4; int r = px[i + 2], g = px[i + 1], bl = px[i]; if (r > 150 && g > 120 && bl < 110 && r - bl > 80 && g - bl > 50) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    return n < 12 ? null : new int[] { x0, y0, x1 - x0 + 1, y1 - y0 + 1 };
  }
  // Monta a "coluna normalizada": cada espaço vira um quadrado de 32x32 com o miolo do espaço (fx, fy, fw, fh = frações da
  // largura e da altura do espaço, a partir da borda), reamostrado com bicúbica. A classificação não depende mais da escala.
  public static System.Drawing.Bitmap Column(System.Drawing.Bitmap strip, double xL, double xR, double y0, double pitch, double slotH, int count, double fx, double fy, double fw, double fh) {
    var cell = 32; var col = new System.Drawing.Bitmap(cell, cell * count, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
    using (var g = System.Drawing.Graphics.FromImage(col)) {
      g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic; g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.Half; g.Clear(System.Drawing.Color.Black);
      double w = xR - xL;
      for (int k = 0; k < count; k++) {
        double sx = xL + fx * w, sy = y0 + k * pitch + fy * slotH, sw = fw * w, sh = fh * slotH;
        var src = new System.Drawing.RectangleF((float)sx, (float)sy, (float)sw, (float)sh);
        if (src.Left < 0 || src.Top < 0 || src.Right > strip.Width || src.Bottom > strip.Height) continue;
        g.DrawImage(strip, new System.Drawing.RectangleF(0, k * cell, cell, cell), src, System.Drawing.GraphicsUnit.Pixel);
      }
    }
    return col;
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
# Onde o HUD mostra cada número (frações do retângulo 16:9 do HUD, medidas numa captura 2044x1149; a geometria do overlay confere
# estes números em tests/overlay-geometry.test.mjs, então a posição "lógica" fica aqui como sempre).
$GOLD  = @{ X = 0.5316; Y = 0.8191; W = 0.0235; H = 0.0261 }
$LEVEL = @{ X = 0.2009; Y = 0.8174; W = 0.0196; H = 0.0244 } # só o número depois de "Nv."
$XP    = @{ X = 0.2420; Y = 0.8174; W = 0.0284; H = 0.0244 }
$STAGE = @{ X = 0.3982; Y = 0.0070; W = 0.0201; H = 0.0226 } # "3-1" no topo (layout do estágio 2 em diante, cabeçalho expandido)
# Os números são lidos por glifo (Glyph): o recorte tem folga em volta e o texto é achado por segmentação, não por posição exata.
function Padded($r, [double]$px, [double]$py) { @{ X = $r.X - $px; Y = $r.Y - $py; W = $r.W + 2 * $px; H = $r.H + 2 * $py } }
$GOLD_READ  = Padded $GOLD 0.004 0.004
$LEVEL_READ = Padded $LEVEL 0.004 0.004
$XP_READ    = Padded $XP 0.004 0.004
# O rótulo do estágio muda de lugar com o layout do cabeçalho (ver Read-StageGlyph): a faixa do topo inteira é varrida.
$STAGE_BAND = @{ X = 0.3400; Y = 0.0030; W = 0.1500; H = 0.0306 }
$GLYPH_CONTRAST = 30 # contraste mínimo (tinta - fundo) para haver texto no recorte
$GLYPH_MAX = 0.25    # distância (RMS, 0..1) máxima do glifo ao gabarito do caractere
$GLYPH_GAP = 0.03    # folga para o melhor gabarito de OUTRO caractere (ou o 1º a 70% do 2º)
# O selo do removedor só viu poucos dígitos nos gravados (3, 4, 5): mais restrito, para um dígito desconhecido virar "?" (e a
# quantidade 1) em vez de outro número. Medido: acertos de outra partida até 0,30, dígitos nunca vistos a partir de 0,24.
$GLYPH_MAX_BY = @{ badge = 0.20 }
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
$LATTICE_HITS = 3   # espaços (de 10) cujo topo ou borda de baixo precisam bater na grade para a coluna valer como achada
# Miolo do espaço, em frações da largura e da altura medidas entre as bordas (o ícone fica dentro da moldura).
$BANK_CELL = @{ FX = 0.09; FY = 0.14; FW = 0.90; FH = 0.84 }

# Gabaritos de glifo (screen-glyphs.json, montado por scripts/screen-glyphs.mjs a partir de quadros reais e do GEP como verdade).
# Sem o arquivo os números voltam ao OCR do Windows (reserva, bem menos preciso nos dígitos pequenos).
$glyphFile = Join-Path $PSScriptRoot 'screen-glyphs.json'
if (Test-Path $glyphFile) {
  $glyphDoc = Get-Content -Raw -Encoding UTF8 $glyphFile | ConvertFrom-Json
  foreach ($set in $glyphDoc.sets.PSObject.Properties) { foreach ($ch in $set.Value.PSObject.Properties) { foreach ($b64 in @($ch.Value)) { [Glyph]::Add($set.Name, [char]$ch.Name, [string]$b64) } } }
}
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
function Read-Region([System.Drawing.Bitmap]$bitmap, [switch]$Tile, [switch]$Whole, [int]$Zoom = 3) {
  $columns = if ($Whole) { @(0, ($bitmap.Width - 1)) } else { [Tft]::BrightColumns($bitmap, 150) }; if ($columns[1] -lt 0) { return '' }
  $h = $bitmap.Height; $pad = [Math]::Max(1, [int]($h * 0.06))
  $sx = [Math]::Max(0, $columns[0] - $pad); $sw = [Math]::Min($bitmap.Width, $columns[1] + $pad + 1) - $sx
  $tw = $sw * $Zoom; $th = $h * $Zoom; $margin = $th; $copies = if ($Tile) { 3 } else { 1 }
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
function Read-FieldOcr([string]$field, [System.Drawing.Bitmap]$bitmap) {
  $text = ''; $value = $null
  if ($field -eq 'gold') { $text = Read-Region $bitmap -Tile; $value = Parse-Tiled $text }
  elseif ($field -eq 'level') { $text = Read-Region $bitmap -Tile; $n = Parse-Tiled $text; if ($null -ne $n -and $n -ge 1 -and $n -le 11) { $value = $n } }
  elseif ($field -eq 'stage') { $text = Read-Region $bitmap -Tile; $n = Parse-Tiled $text; if ($null -ne $n -and $n -ge 11 -and $n -le 97 -and $n % 10 -ge 1 -and $n % 10 -le 7) { $value = '' + [Math]::Floor($n / 10) + '-' + ($n % 10) } }
  else { $text = Read-Region $bitmap; if ($text -match '(\d{1,3})\s*/\s*(\d{1,3})') { $value = $Matches[1] + '/' + $Matches[2] } }
  @{ text = $text; value = $value; parts = @() }
}
function Glyph-Parts($r) {
  @($r.Parts | ForEach-Object { @{ x = $_.X; y = $_.Y; w = $_.W; h = $_.H; ch = [string]$_.Ch; d1 = (Num $_.D1); d2 = (Num $_.D2); v = $(if ($_.V) { [Glyph]::Encode($_.V) } else { $null }) } })
}
# Limiares tentados em ordem (múltiplos do Otsu): os mais baixos fecham o anel do 0 que o traço fino de 720p abre; os mais altos
# separam glifos colados ("/2" do XP) e soltam o texto de um fundo claro atrás do cabeçalho (carrossel).
$GLYPH_SCALES = @(1.0, 0.8, 0.65, 1.15, 1.3, 1.45)
# Quantos limiares precisam dar o MESMO valor para o campo valer: um dígito solto (ouro, nível) é o que um traço do cenário imita
# (a borda de uma sombra lida como "1" quando a barra de baixo está escondida); o texto verdadeiro sai igual em vários limiares.
$GLYPH_AGREE = @{ gold = 2; level = 2 }
# Lê o recorte como texto do conjunto: o valor é o primeiro que $accept (texto -> valor ou $null) aceita em $GLYPH_AGREE limiares
# seguidos de qualquer ordem; devolve texto, valor e glifos (com -Dump, os glifos de todos os limiares, para os gabaritos).
function Glyph-Read([System.Drawing.Bitmap]$bitmap, [string]$set, [scriptblock]$accept, [bool]$invert = $false) {
  $need = if ($GLYPH_AGREE.ContainsKey($set)) { $GLYPH_AGREE[$set] } else { 1 }
  $max = if ($GLYPH_MAX_BY.ContainsKey($set)) { $GLYPH_MAX_BY[$set] } else { $GLYPH_MAX }
  $votes = @{}; $values = @{}; $texts = @{}; $win = $null; $first = $null; $dump = @{}
  foreach ($sc in $GLYPH_SCALES) {
    $r = [Glyph]::Read($bitmap, $set, $invert, $GLYPH_CONTRAST, $max, $GLYPH_GAP, $sc)
    if ($Dump) { $dump["s$([int]($sc * 100))"] = @(Glyph-Parts $r) }
    if ($null -eq $first) { $first = $r.Text }
    $v = & $accept $r.Text
    if ($null -ne $v) {
      $key = [string]$v; $votes[$key] = 1 + [int]$votes[$key]; $values[$key] = $v; $texts[$key] = $r.Text
      if (-not $win -and $votes[$key] -ge $need) { $win = $key; if (-not $Dump) { break } }
    }
  }
  $out = if ($win) { @{ text = $texts[$win]; value = $values[$win]; parts = @() } } else { @{ text = $first; value = $null; parts = @() } }
  if ($Dump) { $out.parts = $dump }
  $out
}
# Estágio: o texto "3-2" muda de lugar com o layout do cabeçalho (estágio 1 tem o painel mais estreito; recolhido ou expandido, o
# rótulo anda), então a faixa do topo (ver $STAGE_BAND) é varrida por janelas do tamanho do rótulo; a janela que lê "d-d" com os dois
# dígitos reconhecidos vale, e a última posição que acertou é tentada primeiro. Componentes cortados pela borda da janela (ícones
# vizinhos) são descartados pelo próprio Glyph.Scan. Em -Dump a primeira janela com forma "glifo, hífen, glifo" fornece os glifos.
$stageAt = -1
function Read-StageGlyph([System.Drawing.Bitmap]$bitmap) {
  $h = $bitmap.Height; $ww = [Math]::Min($bitmap.Width, [int]($h * 1.9)); $step = [Math]::Max(2, [int]($h * 0.4)); $last = $bitmap.Width - $ww
  $order = @(); if ($script:stageAt -ge 0) { $order += $script:stageAt }; for ($x = 0; $x -le $last; $x += $step) { $order += $x }
  $best = @{ text = ''; value = $null; parts = @() }; $accept = { param($t) if ($t -match '(?<![\d?])([1-9])-([1-7])(?![\d?])') { $Matches[0] } else { $null } }
  foreach ($x in $order) {
    $crop = $bitmap.Clone((New-Object System.Drawing.Rectangle $x, 0, $ww, $h), $bitmap.PixelFormat)
    $g = Glyph-Read $crop 'stage' $accept
    if ($null -ne $g.value) { $crop.Dispose(); $script:stageAt = $x; return $g }
    if ($Dump -and -not $best.parts.Count) { foreach ($k in $g.parts.Keys) { if ((@($g.parts[$k]) | ForEach-Object { if ($_.ch -eq '-') { '-' } else { 'g' } }) -join '' -match '^g-g$') { $best = $g; break } } }
    $crop.Dispose()
  }
  $script:stageAt = -1; $best
}
# Lê um campo do HUD por glifo. Devolve o texto lido ('?' = glifo não reconhecido), o valor interpretado ($null = não lido) e os
# glifos (para os gabaritos). Sem gabaritos carregados cai no OCR do Windows.
$FIELD_ACCEPT = @{
  gold  = { param($t) if ($t -match '^\d{1,3}$') { [int]$t } else { $null } }
  level = { param($t) if ($t -match '^\d{1,2}$' -and [int]$t -ge 1 -and [int]$t -le 11) { [int]$t } else { $null } }
  xp    = { param($t) if ($t -match '^(\d{1,2})/(\d{1,3})$' -and [int]$Matches[1] -le [int]$Matches[2]) { $t } else { $null } }
}
$BADGE_ACCEPT = { param($t) if ($t -match '^\d{1,2}$' -and [int]$t -ge 1) { [int]$t } else { $null } }
function Read-Field([string]$field, [System.Drawing.Bitmap]$bitmap) {
  $g = if ($field -eq 'stage') { Read-StageGlyph $bitmap } else { Glyph-Read $bitmap $field $FIELD_ACCEPT[$field] }
  if ([Glyph]::Count($field) -eq 0) {
    # Sem gabaritos (screen-glyphs.json ausente): o OCR do Windows, e para o estágio só a parte da faixa onde o rótulo fica do estágio 2 em diante.
    $src = $bitmap
    if ($field -eq 'stage') { $sx = [int]($bitmap.Width * 0.37); $src = $bitmap.Clone((New-Object System.Drawing.Rectangle $sx, 0, ([int]($bitmap.Width * 0.19)), $bitmap.Height), $bitmap.PixelFormat) }
    $o = Read-FieldOcr $field $src; if ($src -ne $bitmap) { $src.Dispose() }; $o.parts = $g.parts; return $o
  }
  $g
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

$testBitmap = $null; $testing = [bool]($TestImage -or $TestManifest); $frames = @(); $frameAt = 0
if ($TestImage) { $testBitmap = New-Object System.Drawing.Bitmap $TestImage }
if ($TestManifest) { $frames = @(Get-Content -Raw -Encoding UTF8 $TestManifest | ConvertFrom-Json | ForEach-Object { $_ }) }
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
# Acha a coluna do banco medindo a grade dos espaços na própria imagem (Bank.Lattice): o passo entre os espaços, o primeiro topo e
# as bordas laterais. O HUD não escala linearmente com a altura da janela (passo de 36 px em 720p, 56 px em 1149p), então frações
# medidas numa captura só valem naquela; a coluna também fica na borda esquerda da janela, e não no retângulo 16:9 centralizado
# (numa janela 2560x1351 as duas posições diferem 79 px, e a lista de sinergias ao lado virava "item" reconhecido).
# Devolve @{ ok; covered; strip (a faixa capturada, a liberar); lat; sx; sy }.
function Locate-Column($client, $hud) {
  $H = $hud[3]; $off = $hud[0] - $client[0]; $sx = [int]$client[0]; $sy = [int]($hud[1] + 0.15 * $H); $sw = [int][Math]::Min($client[2] - 1, $off + 0.13 * $H); $sh = [int][Math]::Min($hud[1] + $H - $sy - 1, 0.65 * $H)
  if ($sw -lt 40 -or $sh -lt 100) { return @{ ok = $false; covered = $false; strip = $null } }
  # Outra janela por cima da borda esquerda do jogo: não há o que medir (não conta como "sem grade").
  if (-not $testBitmap -and -not [Tft]::Shows([int]($sx + 0.03 * $H), [int]($sy + 0.3 * $H))) { return @{ ok = $false; covered = $true; strip = $null } }
  $strip = Grab-Px $sx $sy $sw $sh
  $lat = [Bank]::Lattice($strip, $SLOT.Count, 0.040 * $H, 0.060 * $H, 0.07 * $H, 0.115 * $H, $off + 0.045 * $H, $LATTICE_HITS)
  @{ ok = ($lat[0] -eq 1); covered = $false; strip = $strip; lat = $lat; sx = $sx; sy = $sy }
}
# Geometria suposta (frações medidas na calibração) para quando a grade não é achada: o miolo de cada espaço já na grade do SLOT.
function Assumed-Geo($hud, $sx, $sy) {
  $H = $hud[3]; $pw = [int][Math]::Round($H * 16 / 9); $x = $hud[0] + $SLOT.X * $pw - $sx
  @{ mode = 'assumed'; xL = $x; xR = $x + $SLOT.W * $pw; y0 = $hud[1] + $SLOT.Y * $H - $sy; pitch = $SLOT.Pitch * $H; slotH = $SLOT.H * $H; fx = 0.0; fy = 0.0; fw = 1.0; fh = 1.0; sx = $sx; sy = $sy }
}
$md5 = [System.Security.Cryptography.MD5]::Create()
function Hash([System.Drawing.Bitmap]$bitmap) { $stride = 0; [BitConverter]::ToString($md5.ComputeHash([Tft]::Bytes($bitmap, [ref]$stride))) }

$removerSlots = @{}; $tick = 0; $cardLines = @()
$state = @{ window = $false; removers = $null; stage = $null; gold = $null; level = $null; xp = $null; items = @(); unknownItems = 0; shop = @('', '', '', '', '') }
$hashes = @{}; $slotSignatures = @{}; $slotValues = @{}; $lastLine = ''; $baseOf = @{}; $lastClientKey = ''; $slotGeo = $null; $frameMiss = 0; $slotKnown = @{}; $slotDebug = @{}
while ($true) {
  $debug = @(); $frameId = $null; $glyphDump = @{}
  try {
    if ($TestManifest) {
      # Quadro a frio: o que o leitor guarda de uma leitura para outra (recortes, memória dos espaços, base achada) não vaza entre quadros.
      if ($frameAt -ge $frames.Count) { break }
      $frame = $frames[$frameAt++]; $frameId = $frame.id; if ($testBitmap) { $testBitmap.Dispose() }
      $testBitmap = New-Object System.Drawing.Bitmap $frame.image; $TestClient = $frame.client
      $hashes = @{}; $slotSignatures = @{}; $baseOf = @{}; $slotGeo = $null; $frameMiss = 0; $slotKnown = @{}; $slotDebug = @{}; $slotValues = @{}; $removerSlots = @{}; $lastLine = ''; $lastClientKey = ''; $cardLines = @(); $tick = 0
      $state = @{ window = $false; removers = $null; stage = $null; gold = $null; level = $null; xp = $null; items = @(); unknownItems = 0; shop = @('', '', '', '', '') }
    }
    $client = if ($testing) { $TestClient -split ',' | ForEach-Object { [int]$_ } } else { [Tft]::Client() }
    if (-not $client) { $state.window = $false }
    else {
      $state.window = $true
      # Janela redimensionada: as posições mudam, então recortes, assinaturas e a base que funcionava são descartados.
      $clientKey = $client -join ','
      if ($clientKey -ne $lastClientKey) { $lastClientKey = $clientKey; $hashes = @{}; $slotSignatures = @{}; $baseOf = @{}; $slotGeo = $null; $frameMiss = 0; $slotKnown = @{}; $slotDebug = @{}; $lastLine = '' }
      $hudBottom = Hud-Rect $client 'bottom'; $hudTop = Hud-Rect $client 'top'
      foreach ($field in 'gold', 'level', 'xp', 'stage') {
        $region = @{ gold = $GOLD_READ; level = $LEVEL_READ; xp = $XP_READ; stage = $STAGE_BAND }[$field]
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
            $read = Read-Field $field $bitmap; if ($Dump) { $glyphDump[$field] = $read.parts }
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
      if ($round -le 2 -and (Shown $hudBottom $BAND $BAND.Y $BAND.H)) { if ($tick % 2 -eq 0 -or $testing) { $wide = Grab $hudBottom $BAND $BAND.Y $BAND.H; $cardLines = @(Recognize $wide -Lines | Where-Object { $_ -and $_.Length -ge 4 } | Select-Object -First 40 | ForEach-Object { [string]$_ }); $wide.Dispose() } } else { $cardLines = @() }
      # Loja: o nome de cada carta é texto; carta vazia (comprada) não tem pixels claros e vira ''.
      for ($i = 0; $i -lt $SHOP.Count; $i++) {
        $card = @{ X = $SHOP.X + $SHOP.Pitch * $i; W = $SHOP.W }
        if (-not (Shown $hudBottom $card $SHOP.Y $SHOP.H)) { continue } # coberta: mantém a última leitura
        $bitmap = Grab $hudBottom $card $SHOP.Y $SHOP.H; $hash = Hash $bitmap
        if ($hashes["shop$i"] -ne $hash) {
          $hashes["shop$i"] = $hash; $text = (Read-Region $bitmap).Trim()
          # Há texto na carta e o OCR não leu nada (nomes curtos como "Veigar" somem em alguns tamanhos): tenta outros aumentos.
          if (-not $text -and [Tft]::BrightColumns($bitmap, 150)[1] -ge 0) { foreach ($zoom in 4, 2, 5) { $text = (Read-Region $bitmap -Zoom $zoom).Trim(); if ($text) { break } } }
          $state.shop[$i] = $text; $debug += "shop$i='$text'"
        }
        $bitmap.Dispose()
      }
      # Banco de itens: a grade dos espaços é medida na imagem a cada laço (Locate-Column) e cada espaço vira um quadrado de 32 px
      # (Bank.Column) que só é reclassificado quando muda. Sem grade confirmada (3 laços seguidos) vale a geometria suposta
      # ("assumida"), que só aceita item com evidência forte: é melhor "?" do que um item errado.
      $loc = Locate-Column $client $hudBottom
      if ($loc.strip) {
        $lat = $loc.lat
        if ($loc.ok) {
          $frameMiss = 0
          $geo = @{ mode = 'frame'; xL = $lat[1]; xR = $lat[2]; y0 = $lat[3]; pitch = $lat[4]; slotH = $lat[5]; fx = $BANK_CELL.FX; fy = $BANK_CELL.FY; fw = $BANK_CELL.FW; fh = $BANK_CELL.FH; sx = $loc.sx; sy = $loc.sy }
          # Só reposiciona se a grade andou mais que o jitter de 2 px (ou se estava assumida): memória e assinaturas dos espaços perdem o sentido.
          if ($slotGeo -and $slotGeo.mode -eq 'frame' -and [Math]::Abs($slotGeo.xL - $geo.xL) -le 2 -and [Math]::Abs($slotGeo.y0 - $geo.y0) -le 2 -and [Math]::Abs($slotGeo.pitch - $geo.pitch) -le 0.6 -and $slotGeo.sy -eq $geo.sy) { $geo = $slotGeo } else { $slotSignatures = @{}; $slotKnown = @{} }
          $slotGeo = $geo
        } else {
          $frameMiss++
          if (-not $slotGeo -or ($slotGeo.mode -eq 'frame' -and $frameMiss -ge 3)) { $slotGeo = Assumed-Geo $hudBottom $loc.sx $loc.sy; $slotSignatures = @{}; $slotKnown = @{} }
        }
        $geo = $slotGeo; $assumed = $geo.mode -ne 'frame'
        $state.bankGeo = @{ mode = $geo.mode; x = [int]($geo.sx + $geo.xL); pitch = (Num $geo.pitch); hits = [int]$lat[6]; edge = (Num $lat[7]); client = $clientKey }
        $column = [Bank]::Column($loc.strip, $geo.xL, $geo.xR, $geo.y0, $geo.pitch, $geo.slotH, $SLOT.Count, $geo.fx, $geo.fy, $geo.fw, $geo.fh)
        $cell = $column.Width
        for ($i = 0; $i -lt $SLOT.Count; $i++) {
          if (-not $testBitmap -and -not [Tft]::Shows([int]($geo.sx + $geo.xL + ($geo.xR - $geo.xL) / 2), [int]($geo.sy + $geo.y0 + $geo.pitch * $i + $geo.slotH / 2))) { continue } # coberto: mantém o último valor
          $sy = $cell * $i
          $signature = [Tft]::Signature($column, 0, $sy, $cell, $cell)
          if ($slotSignatures[$i] -and [Tft]::Distance($signature, $slotSignatures[$i]) -lt 4) { continue }
          $slotSignatures[$i] = $signature
          $removerSlots.Remove($i)
          $c = Classify-Slot $column $sy $cell $assumed
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
          # Removedor empilha: o número no canto superior esquerdo do ícone é a quantidade (selo amarelo com número escuro).
          if ($slotValues[$i] -match 'ItemRemover') {
            $w = $geo.xR - $geo.xL; $bx = $geo.xL + $geo.fx * $w; $by = $geo.y0 + $geo.pitch * $i + $geo.fy * $geo.slotH
            $bw = [int][Math]::Max(8, 0.64 * $geo.fw * $w); $bh = [int][Math]::Max(8, 0.56 * $geo.fh * $geo.slotH)
            $bx = [int][Math]::Max(0, $bx); $by = [int][Math]::Max(0, $by); $bw = [Math]::Min($bw, $loc.strip.Width - $bx); $bh = [Math]::Min($bh, $loc.strip.Height - $by)
            $region = $loc.strip.Clone((New-Object System.Drawing.Rectangle $bx, $by, $bw, $bh), $loc.strip.PixelFormat)
            # O selo é o retângulo amarelo no canto: recorta só ele (com o ícone junto, o limiar do Otsu separaria a arte, não o número). Com a
            # tela escurecida não há amarelo vivo e vale o recorte do canto inteiro (menos preciso).
            $box = [Bank]::YellowBox($region)
            if ($box) { $kx = $box[0] + 1; $ky = $box[1] + 1; $kw = [Math]::Max(4, $box[2] - 2); $kh = [Math]::Max(4, $box[3] - 2) } else { $kx = 0; $ky = 0; $kw = $region.Width; $kh = $region.Height }
            $badge = $region.Clone((New-Object System.Drawing.Rectangle $kx, $ky, $kw, $kh), $region.PixelFormat)
            $region.Dispose()
            $count = $null; $badgeText = ''
            if ([Glyph]::Count('badge') -gt 0 -or $Dump) {
              $bg = Glyph-Read $badge 'badge' $BADGE_ACCEPT $true; $badgeText = $bg.text; $count = $bg.value; if ($Dump) { $glyphDump['badge'] = $bg.parts }
            }
            if ([Glyph]::Count('badge') -eq 0) { $badgeText = Read-Region $badge -Tile -Whole; $count = Parse-Tiled $badgeText }
            $debug += "selo='$badgeText'"; $badge.Dispose(); $removerSlots[$i] = if ($null -ne $count -and $count -ge 1 -and $count -le 99) { $count } else { 1 }; $debug += "slot$i removedores=$($removerSlots[$i])"
          }
        }
        $column.Dispose(); $loc.strip.Dispose()
      }
      $state.items = @(0..($SLOT.Count - 1) | ForEach-Object { $slotValues[$_] } | Where-Object { $_ -and $_ -ne '?' })
      $state.unknownItems = @(0..($SLOT.Count - 1) | Where-Object { $slotValues[$_] -eq '?' }).Count
      $state.removers = ($removerSlots.Values | Measure-Object -Sum).Sum; if ($null -eq $state.removers) { $state.removers = 0 }
    }
    $line = (@{ id = $frameId; window = $state.window; removers = $state.removers; stage = $state.stage; gold = $state.gold; level = $state.level; xp = $state.xp; items = @($state.items); unknownItems = $state.unknownItems; bankDebug = @(0..($SLOT.Count - 1) | Where-Object { $slotDebug[$_] } | ForEach-Object { $slotDebug[$_] }); bankGeo = $state.bankGeo; shop = @($state.shop); band = @($cardLines); glyphs = $(if ($Dump) { $glyphDump } else { $null }) } | ConvertTo-Json -Compress -Depth 6)
    if ($line -ne $lastLine) { $lastLine = $line; [Console]::Out.WriteLine($line) }
    if ($TestImage) { $debug | ForEach-Object { [Console]::Out.WriteLine($_) } }
  } catch {
    # Leitura interrompida: relê todos os recortes no próximo laço (o hash pode ter sido gravado sem a leitura)
    # e reemite a próxima linha boa mesmo igual à anterior, para o .mjs limpar o erro.
    $hashes = @{}; $slotSignatures = @{}; $lastLine = ''
    [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress))
  }
  if ($TestImage) { break }
  if ($TestManifest) { continue }
  if ($ParentPid -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds $IntervalMs
}
