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
  assert(!surface.revealSources.isEmpty)
  for fields in surface.revealFields{
   assert(fields.count==surface.revealSources.count)
   for (slot,field) in fields.enumerated(){
    let index=surface.revealSources[slot]
    assert(field.type == .radial,"Each fading tile must open its own radial region")
    let opening=field.animation(forKey:"localReveal")!
    let fade=surface.pieces[index].animation(forKey:"fallingFade")!
    assert(abs(opening.beginTime-fade.beginTime-fade.duration)<0.001,"Background diffusion must start after its tile has finished fading")
    assert(opening.duration>=(cold ? 0.6:0.44)-0.00001,"Diffusion must have enough time to be visible")
    let centerFade=(opening as! CAAnimationGroup).animations![1] as! CAKeyframeAnimation
    assert(centerFade.keyTimes![1].doubleValue<=0.3,"Center opens early, leaving time for outward expansion")
    let spread=(opening as! CAAnimationGroup).animations![0] as! CAKeyframeAnimation
    assert(spread.values!.count>80,"Diffusion includes exact tile fade boundaries")
    let last=spread.values!.last as! [NSNumber]
    assert(last[7].doubleValue>0.99,"Every expanding region must finish before removal")
    let center=surface.revealCenter(index)
    assert(abs(field.startPoint.x*surface.bounds.width-center.x)<0.001)
    assert(abs(field.startPoint.y*surface.bounds.height-center.y)<0.001)
    let radiusX=(field.endPoint.x-field.startPoint.x)*surface.bounds.width
    let radiusY=(field.endPoint.y-field.startPoint.y)*surface.bounds.height
    assert(abs(radiusX-radiusY)<0.001,"Diffusion must spread evenly in screen space")
    if slot+1<fields.count{assert(field.mask === fields[slot+1])}
    end=max(end,opening.beginTime+opening.duration)
   }
  }
  let fields=surface.revealFields[0]
  for y in 0...8{for x in 0...8{
   let point=CGPoint(x:surface.bounds.width*Double(x)/8,y:surface.bounds.height*Double(y)/8)
   assert(fields.contains{field in
    let center=CGPoint(x:field.startPoint.x*surface.bounds.width,y:field.startPoint.y*surface.bounds.height)
    let core=(field.endPoint.x-field.startPoint.x)*surface.bounds.width*0.45
    return hypot(center.x-point.x,center.y-point.y)<core
   },"Clear cores must cover every corner and gap before removal")
  }}
  let lastVisible=surface.pieces.indices.filter{surface.bounds.contains(surface.revealCenter($0))}.max{fadeEnds[$0]<fadeEnds[$1]}!
  let lastVisibleFade=surface.pieces[lastVisible].animation(forKey:"fallingFade")!
  var sawLastTileFade=false
  var sawSpatialReveal=false
  while CACurrentMediaTime()<end-0.025{
   RunLoop.main.run(until:Date().addingTimeInterval(0.015))
   let now=CACurrentMediaTime()
   for field in fields{
    let opening=field.animation(forKey:"localReveal")!
    let progress=(now-opening.beginTime)/opening.duration
    if let presented=field.presentation(),let colors=presented.colors as? [CGColor]{
     if progress < -0.025{assert(colors[0].alpha>0.99,"Future regions must remain covered")}
     if progress>0.25 && progress<0.75{
      assert(colors[0].alpha<0.25,"The center must already be visibly open while the edge expands")
      if progress>0.4{assert(colors[0].alpha<0.01,"Center stays clear during the outward spread")}
      assert(colors.last!.alpha>0.99,"The outside of each radial region stays opaque")
      assert((presented.locations?[1].doubleValue ?? 0)>0,"The clear core must expand outward")
      sawSpatialReveal=true
     }
    }
   }
   let lastProgress=(now-lastVisibleFade.beginTime)/lastVisibleFade.duration
   if lastVisibleFade.duration>0.1 && lastProgress>0.25 && lastProgress<0.75{
    let opacity=surface.pieces[lastVisible].presentation()!.opacity
    assert(opacity>0.01 && opacity<surface.crestOpacity-0.01,"The final visible tile must have actual intermediate fade frames")
    let context=CGContext(data:nil,width:224,height:144,bitsPerComponent:8,bytesPerRow:896,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.scaleBy(x:0.2,y:0.2);surface.layer!.presentation()!.render(in:context)
    let pixels=context.data!.assumingMemoryBound(to:UInt8.self)
    let center=surface.revealCenter(lastVisible)
    let x=max(0,min(223,Int(center.x*0.2))),y=max(0,min(143,Int(center.y*0.2)))
    // Bitmap scanlines run from the top; the AppKit surface uses bottom-up coordinates.
    assert(pixels[((143-y)*224+x)*4+3]>250,"The actual composed background under the last tile must remain opaque during its fade")
    sawLastTileFade=true
   }
   // No earlier expansion may erase the support beneath a still-visible tile.
   for (i,tile) in surface.pieces.enumerated() where now<fadeEnds[i]-0.01{
    let center=surface.revealCenter(i)
    guard surface.bounds.contains(center), (tile.presentation()?.opacity ?? 0)>0.01 else{continue}
    for field in fields{
     if let presented=field.presentation(),let locations=presented.locations{
      let origin=CGPoint(x:field.startPoint.x*surface.bounds.width,y:field.startPoint.y*surface.bounds.height)
      let radius=(field.endPoint.x-field.startPoint.x)*surface.bounds.width*locations[7].doubleValue
      assert(hypot(center.x-origin.x,center.y-origin.y)>=radius-0.5,"A neighboring diffusion must not clear the background under a visible tile")
     }
    }
   }
   for (i,item) in surface.pieces.enumerated() where now>fadeEnds[i]+0.025{
    assert((item.presentation()?.opacity ?? 0)<0.01,"A disappeared tile must stay invisible")
    assert(abs((item.presentation()?.transform.m42 ?? 0)/surface.liftY)<0.3,"Landed tiles must not start rising again during the exit")
   }
  }
  assert(sawSpatialReveal,"Must observe the expanding radial background regions in real presentation layers")
  if lastVisibleFade.duration>0.1{assert(sawLastTileFade,"Must inspect the final tile before its fade completes")}
  // Inspect the composed image, not just animation values, before removal.
  if let presented=surface.layer?.presentation(){
   let context=CGContext(data:nil,width:224,height:144,bitsPerComponent:8,bytesPerRow:896,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
   context.scaleBy(x:0.2,y:0.2);presented.render(in:context)
   let pixels=context.data!.assumingMemoryBound(to:UInt8.self)
   let maximum=(0..<(224*144)).map{Int(pixels[$0*4+3])}.max()!
   assert(maximum<16,"Overlay must already be visually clear before it is removed")
  }
 }
 RunLoop.main.run(until:Date().addingTimeInterval(max(0,end-CACurrentMediaTime())+0.1))
 assert(completed==1 && surface.superview==nil)
 assert(surface.pieces.allSatisfy{$0.animationKeys()==nil})
 assert(surface.revealFields.flatMap{$0}.allSatisfy{$0.animationKeys()==nil})
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
    subprocess.run(['swiftc', '-Onone', '-module-cache-path', cache, str(swift), '-o', str(executable)], check=True)
    subprocess.run([str(executable)], check=True, timeout=35)
