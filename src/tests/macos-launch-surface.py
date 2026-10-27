"""Exercise real Core Animation presentation layers in an off-screen test window."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

if sys.platform != 'darwin':
    print('SKIP macOS launch surface requires AppKit')
    raise SystemExit(0)

source = (Path(__file__).resolve().parents[1] / 'macos.swift').read_text()
start = source.index('final class JournalLaunchSurface:')
end = source.index('// Center the actual Chinese glyph', start)
checks = r'''
let app=NSApplication.shared
app.setActivationPolicy(.accessory)
func check(_ cold:Bool){
 let window=NSWindow(contentRect:NSRect(x:-12000,y:-12000,width:1120,height:720),styleMask:[.borderless],backing:.buffered,defer:false)
 window.isReleasedWhenClosed=false
 let surface=JournalLaunchSurface(frame:NSRect(x:0,y:0,width:1120,height:720),cold:cold)
 window.contentView=surface;window.orderBack(nil);surface.layoutSubtreeIfNeeded();CATransaction.flush()
 assert(surface.artwork.opacity==1,"Warm opens must show movement immediately")
 let tile=surface.pieces[0]
 func height()->Double{(tile.presentation()?.transform.m42 ?? 0)/surface.liftY}
 var heights:[Double]=[]
 for wait in [0.10,0.30,0.45,0.45,0.35]{RunLoop.main.run(until:Date().addingTimeInterval(wait));heights.append(height())}
 if !surface.reduceMotion{
  assert((heights.max() ?? 0)>6,"Movement must remain visible")
  assert(zip(heights,heights.dropFirst()).contains{$1-$0>0.5},"Must keep rising")
  assert(zip(heights,heights.dropFirst()).contains{$0-$1>0.5},"Must descend instead of holding")
  assert((tile.animation(forKey:"ripple")?.repeatCount ?? 0).isInfinite)
 }
 var completed=0
 let ready=CACurrentMediaTime()
 surface.finish{completed+=1}
 surface.finish{completed+=1}
 var end=ready
 var pending:[CALayer]=[]
 if !surface.reduceMotion{
  for item in surface.pieces{
   let wave=item.animation(forKey:"ripple")!,fade=item.animation(forKey:"fallingFade")!
   let phase=(fade.beginTime-wave.beginTime).truncatingRemainder(dividingBy:surface.wavePeriod)
   assert(phase>=surface.wavePeriod/2-0.001,"A rising tile must not fade")
   assert(phase+fade.duration<=surface.wavePeriod+0.001,"Fade must end before the next rise")
   end=max(end,fade.beginTime+fade.duration)
   if fade.beginTime>ready+0.12{pending.append(item)}
  }
 }
 RunLoop.main.run(until:Date().addingTimeInterval(0.05))
 if !pending.isEmpty{assert(pending.contains{($0.presentation()?.opacity ?? 0)>0.15},"Rising tiles must remain visible before their fade begins")}
 RunLoop.main.run(until:Date().addingTimeInterval(max(0,end-CACurrentMediaTime())+0.15))
 assert(completed==1 && surface.superview==nil)
 assert(surface.pieces.allSatisfy{$0.animationKeys()==nil},"No animation may remain after removal")
 window.close()
 print("PASS",cold ? "cold":"warm","continuous heights",heights,"exit ms",(end-ready)*1000)
}
check(true)
check(false)
'''
with tempfile.TemporaryDirectory(prefix='journal-launch-test-') as directory:
    folder = Path(directory)
    swift = folder / 'main.swift'
    swift.write_text('import Cocoa\nimport QuartzCore\n' + source[start:end] + checks)
    executable = folder / 'launch-test'
    cache = os.environ.get('JOURNAL_SWIFT_MODULE_CACHE', str(folder / 'module-cache'))
    subprocess.run(['swiftc', '-O', '-module-cache-path', cache, str(swift), '-o', str(executable)], check=True)
    subprocess.run([str(executable)], check=True, timeout=20)
