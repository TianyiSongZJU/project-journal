param([string]$ResourceCompiler = 'rsrc')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Add-Type -AssemblyName System.Drawing
$drawingReferences = @('System.Drawing.Common', 'System.Drawing.Primitives')
foreach ($dependency in @('System.Private.Windows.GdiPlus', 'System.Private.Windows.Core')) {
    if (Test-Path (Join-Path $PSHOME "$dependency.dll")) { $drawingReferences += $dependency }
}
Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
public static class JournalWindowsIcon {
    public static void Build(string sourcePath, string iconPath) {
        using (var source = new Bitmap(sourcePath)) {
            int left = source.Width, top = source.Height, right = 0, bottom = 0;
            for (int y = 0; y < source.Height; y++)
                for (int x = 0; x < source.Width; x++)
                    if (source.GetPixel(x, y).A >= 240) {
                        left = Math.Min(left, x); top = Math.Min(top, y);
                        right = Math.Max(right, x + 1); bottom = Math.Max(bottom, y + 1);
                    }
            if (right <= left || bottom <= top) throw new InvalidDataException("Empty icon source");
            var crop = Rectangle.FromLTRB(left, top, right, bottom);
            int[] sizes = {16, 20, 24, 32, 40, 48, 64, 128, 256};
            byte[][] images = new byte[sizes.Length][];
            for (int i = 0; i < sizes.Length; i++) {
                int size = sizes[i];
                using (var bitmap = new Bitmap(size, size, PixelFormat.Format32bppArgb))
                using (var graphics = Graphics.FromImage(bitmap))
                using (var buffer = new MemoryStream()) {
                    graphics.Clear(Color.Transparent);
                    graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    graphics.CompositingQuality = CompositingQuality.HighQuality;
                    float scale = size / (float)Math.Max(crop.Width, crop.Height);
                    float width = crop.Width * scale, height = crop.Height * scale;
                    graphics.DrawImage(source, new RectangleF((size-width)/2, (size-height)/2, width, height), crop, GraphicsUnit.Pixel);
                    bitmap.Save(buffer, ImageFormat.Png);
                    images[i] = buffer.ToArray();
                }
            }
            using (var output = new BinaryWriter(File.Create(iconPath))) {
                output.Write((ushort)0); output.Write((ushort)1); output.Write((ushort)sizes.Length);
                int offset = 6 + 16 * sizes.Length;
                for (int i = 0; i < sizes.Length; i++) {
                    output.Write((byte)(sizes[i] == 256 ? 0 : sizes[i]));
                    output.Write((byte)(sizes[i] == 256 ? 0 : sizes[i]));
                    output.Write((byte)0); output.Write((byte)0);
                    output.Write((ushort)1); output.Write((ushort)32);
                    output.Write(images[i].Length); output.Write(offset);
                    offset += images[i].Length;
                }
                foreach (var image in images) output.Write(image);
            }
        }
    }
}
'@ -ReferencedAssemblies $drawingReferences
$iconPath = Join-Path $projectRoot 'assets/icons/项目手记.ico'
[JournalWindowsIcon]::Build((Join-Path $projectRoot 'assets/icons/项目手记-3x3-1024.png'), $iconPath)
& $ResourceCompiler -arch amd64 -ico $iconPath -manifest (Join-Path $projectRoot 'assets/windows.manifest') -o (Join-Path $projectRoot 'src/app_windows_amd64.syso')
if ($LASTEXITCODE -ne 0) { throw 'Windows resource compilation failed' }
