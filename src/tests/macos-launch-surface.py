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
func check(_ cold:Bool,_ loading:Double){
 let window=NSWindow(contentRect:NSRect(x:-12000,y:-12000,width:1120,height:720),styleMask:[.borderless],backing:.buffered,defer:false)
 window.isReleasedWhenClosed=false
 let surface=JournalLaunchSurface(frame:NSRect(x:0,y:0,width:1120,height:720),cold:cold)
 window.contentView=surface;window.orderBack(nil);surface.layoutSubtreeIfNeeded();CATransaction.flush()
 assert(surface.artwork.opacity==1)
 RunLoop.main.run(until:Date().addingTimeInterval(0.04))
 let initial=surface.pieces.map{($0.presentation()?.transform.m42 ?? 0)/surface.liftY}
 if !surface.reduceMotion{
  assert(cold ? initial[12]<8:initial[12]>8,"Cold center rises; warm center starts near its crest")
  assert((initial.max() ?? 0)-(initial.min() ?? 0)>6)
  for i in 0..<25{
   let diagonal=Double(i/5+i%5)
   assert(abs(surface.waveStarts[i]-surface.waveStarts[0]-diagonal*surface.phaseGap*surface.wavePeriod)<0.00001,"Phases must remain unwrapped across all diagonals")
  }
 }
 RunLoop.main.run(until:Date().addingTimeInterval(loading))
 let ready=CACurrentMediaTime()
 var completed=0
 surface.finish{completed+=1};surface.finish{completed+=1}
 var end=ready
 var fadeEnds:[Double]=[]
 if !surface.reduceMotion{
  let cycle=floor(max(0,ready-surface.waveStarts[0])/surface.waveCycleDuration)
  var byDiagonal:[Double]=Array(repeating:0,count:9)
  for (i,item) in surface.pieces.enumerated(){
   let wave=item.animation(forKey:"ripple")!,fade=item.animation(forKey:"fallingFade")!
   assert(wave.duration==surface.waveCycleDuration)
   let landing=surface.waveStarts[i]+cycle*surface.waveCycleDuration+surface.wavePeriod
   assert(fade.beginTime+fade.duration<=max(ready,landing)+0.01,"Never wait for the next rise to fade an already landed tile")
   assert(fade.beginTime>=max(ready,landing-surface.wavePeriod*0.195)-0.01,"Fade follows two thirds of descent")
   let fadeEnd=fade.beginTime+fade.duration
   fadeEnds.append(fadeEnd);end=max(end,fadeEnd)
   byDiagonal[i/5+i%5]=fadeEnd
  }
  assert(zip(byDiagonal,byDiagonal.dropFirst()).allSatisfy{$0<=$1+0.001},"Leading diagonal must disappear before the following diagonals")
  assert(byDiagonal.last!-byDiagonal.first!<=8*surface.phaseGap*surface.wavePeriod+0.01,"No extra period at the leading edge")
  assert(surface.revealMasks.count==2)
  for background in [surface.backdrop,surface.light]{
   assert(background.opacity==1 && background.animation(forKey:"reveal")==nil,"Background must reveal spatially, not fade uniformly")
  }
  for mask in surface.revealMasks{
   assert(mask.animation(forKey:"directionalReveal") != nil)
   let from=CGPoint(x:mask.startPoint.x*surface.bounds.width,y:mask.startPoint.y*surface.bounds.height)
   let to=CGPoint(x:mask.endPoint.x*surface.bounds.width,y:mask.endPoint.y*surface.bounds.height)
   let direction=CGPoint(x:to.x-from.x,y:to.y-from.y)
   let transform=surface.tiles.affineTransform()
   assert(direction.x*transform.a+direction.y*transform.b>0,"Reveal follows increasing columns")
   assert(direction.x*transform.c+direction.y*transform.d>0,"Reveal follows increasing rows")
   let x=direction.x*transform.a+direction.y*transform.b
   let y=direction.x*transform.c+direction.y*transform.d
   assert(abs(x-y)<0.001,"Rows and columns share the same diagonal phase")
  }
  var sawSpatialReveal=false
  while CACurrentMediaTime()<end-0.025{
   RunLoop.main.run(until:Date().addingTimeInterval(0.015))
   let now=CACurrentMediaTime()
   if let mask=surface.revealMasks.first,let wipe=mask.animation(forKey:"directionalReveal"){
    let progress=(now-wipe.beginTime)/wipe.duration
    if progress>0.35 && progress<0.65,let locations=mask.presentation()?.locations{
     assert(locations[1].doubleValue>0.1 && locations[2].doubleValue<0.9,"Mid-reveal must expose one region while retaining the other")
     assert(locations[2].doubleValue-locations[1].doubleValue>0.2,"Reveal boundary must stay feathered")
     sawSpatialReveal=true
    }
   }
   for (i,item) in surface.pieces.enumerated() where now>fadeEnds[i]+0.025{
    assert((item.presentation()?.opacity ?? 0)<0.01,"A disappeared tile must stay invisible")
    assert(abs((item.presentation()?.transform.m42 ?? 0)/surface.liftY)<0.3,"Landed tiles must not start rising again during the exit")
   }
  }
  assert(sawSpatialReveal,"Must observe the moving background gradient in real presentation layers")
 }
 RunLoop.main.run(until:Date().addingTimeInterval(max(0,end-CACurrentMediaTime())+0.1))
 assert(completed==1 && surface.superview==nil)
 assert(surface.pieces.allSatisfy{$0.animationKeys()==nil})
 assert(surface.revealMasks.allSatisfy{$0.animationKeys()==nil})
 window.close()
 print("PASS",cold ? "cold":"warm","loading",loading,"exit ms",(end-ready)*1000)
}
for loading in [0.12,0.7,2.6]{check(true,loading);check(false,loading)}
'''
with tempfile.TemporaryDirectory(prefix='journal-launch-test-') as directory:
    folder = Path(directory)
    swift = folder / 'main.swift'
    swift.write_text('import Cocoa\nimport QuartzCore\n' + source[start:end] + checks)
    executable = folder / 'launch-test'
    cache = os.environ.get('JOURNAL_SWIFT_MODULE_CACHE', str(folder / 'module-cache'))
    subprocess.run(['swiftc', '-O', '-module-cache-path', cache, str(swift), '-o', str(executable)], check=True)
    subprocess.run([str(executable)], check=True, timeout=35)
