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

precondition(_isDebugAssertConfiguration(),"Assertions must be enabled in the optimized animation test")
let app=NSApplication.shared
app.setActivationPolicy(.accessory)
func checkObliqueGeometry(){
 let surface=JournalLaunchSurface(frame:NSRect(x:0,y:0,width:1120,height:720),cold:true)
 surface.layout();surface.revealSources=[12];surface.layoutRevealMasks()
 let projection=surface.revealProjection()
 let local=surface.revealCenter(12).applying(projection.inverted())
 let fraction=140/surface.revealOuterRadius
 surface.revealPlans=[JournalLaunchSurface.RevealPlan(index:12,begin:0,duration:1,times:[0,1],radii:[fraction,fraction])]
 surface.updateRevealMask(at:0.5)
 let context=surface.revealGray!,bytes=context.data!.assumingMemoryBound(to:UInt8.self)
 func sample(_ offset:CGPoint)->Int{
  let point=CGPoint(x:local.x+offset.x,y:local.y+offset.y).applying(projection)
  let px=point.x/1120*Double(context.width)-0.5,py=(720-point.y)/720*Double(context.height)-0.5
  let x=Int(floor(px)),y=Int(floor(py)),dx=px-Double(x),dy=py-Double(y)
  let a=Double(bytes[y*context.bytesPerRow+x]),b=Double(bytes[y*context.bytesPerRow+x+1])
  let c=Double(bytes[(y+1)*context.bytesPerRow+x]),d=Double(bytes[(y+1)*context.bytesPerRow+x+1])
  return Int((a*(1-dx)+b*dx)*(1-dy)+(c*(1-dx)+d*dx)*dy)
 }
 let column=sample(CGPoint(x:112,y:0)),row=sample(CGPoint(x:0,y:112))
 assert(abs(column-row)<15 && column>20 && column<230,"Feather follows both oblique tile axes with the same profile")
 let tilePoint=surface.tiles.convert(CGPoint(x:local.x+98,y:local.y),to:surface.layer)
 let projected=CGPoint(x:local.x+98,y:local.y).applying(projection)
 assert(hypot(tilePoint.x-projected.x,tilePoint.y-projected.y)<0.001,"Background uses exactly the tile projection")
 print("PASS oblique rounded-square geometry",column,row)
}
func check(_ cold:Bool,_ loading:Double){
 let window=NSWindow(contentRect:NSRect(x:-12000,y:-12000,width:1120,height:720),styleMask:[.borderless],backing:.buffered,defer:false)
 window.isReleasedWhenClosed=false
 let surface=JournalLaunchSurface(frame:NSRect(x:0,y:0,width:1120,height:720),cold:cold)
 window.contentView=surface;window.orderBack(nil);surface.layoutSubtreeIfNeeded();CATransaction.flush()
 RunLoop.main.run(until:Date().addingTimeInterval(0.04))
 if !surface.reduceMotion{
  let height=surface.pieces[12].presentation()!.transform.m42/surface.liftY
  assert(cold ? height<8:height>8,"Cold center rises; warm center starts near its crest")
 }
 RunLoop.main.run(until:Date().addingTimeInterval(loading))
 let ready=CACurrentMediaTime()
 var completed=0
 surface.finish{completed+=1};surface.finish{completed+=1}
 var end=ready
 var partialBackground:[Double]=[]
 var intermediateTileFrames=0
 var overlappingFrames=0
 var firstOverlap:Double=1
 if !surface.reduceMotion{
  assert(surface.revealMasks.count==2 && !surface.revealPlans.isEmpty)
  assert(surface.backdrop.mask!.mask==nil && surface.light.mask!.mask==nil,"Use one shallow image mask, not nested full-window surfaces")
  assert(surface.revealMasks[0].contents as AnyObject === surface.revealMasks[1].contents as AnyObject,"Share the composed alpha image")
  let visible=surface.revealSources
  let minimum=cold ? 0.44:0.33
  let fades=surface.pieces.map{$0.animation(forKey:"fallingFade")!}
  let fadeEnds=fades.map{$0.beginTime+$0.duration}
  let ordered=visible.sorted{($0/5+$0%5)<($1/5+$1%5)}
  for i in visible{
   assert(fades[i].duration>=minimum,"Every visible tile needs a full readable fade")
   assert(fades[i].beginTime>=ready)
  }
  for (a,b) in zip(ordered,ordered.dropFirst()) where a/5+a%5<b/5+b%5{
   assert(fades[b].beginTime-fades[a].beginTime>=0.075,"Successive diagonals need a visible stagger")
  }
  for plan in surface.revealPlans{
   let fade=fades[plan.index]
   assert(abs(plan.begin-fade.beginTime-fade.duration*0.35)<0.001,"Local diffusion prepares early and overlaps the tile fade")
   assert(plan.radii.last!>0.99)
   end=max(end,plan.begin+plan.duration)
  }
  let lastVisible=visible.max{fadeEnds[$0]<fadeEnds[$1]}!
  let lastFade=fades[lastVisible]
  while CACurrentMediaTime()<end-0.025{
   RunLoop.main.run(until:Date().addingTimeInterval(0.015))
   let now=CACurrentMediaTime()
   if let gray=surface.revealGray,let data=gray.data{
    let bytes=data.assumingMemoryBound(to:UInt8.self)
    var sum=0
    for y in 0..<gray.height{for x in 0..<gray.width{sum+=Int(bytes[y*gray.bytesPerRow+x])}}
    let remaining=Double(sum)/Double(gray.width*gray.height*255)
    if remaining>0.05 && remaining<0.95{partialBackground.append(now)}
   }
   let progress=(now-lastFade.beginTime)/lastFade.duration
   if progress>0.25 && progress<0.9{
    let opacity=surface.pieces[lastVisible].presentation()!.opacity
    assert(opacity>0.001 && opacity<surface.crestOpacity-0.01,"The last tile must actually fade through intermediate frames")
    let context=CGContext(data:nil,width:224,height:144,bitsPerComponent:8,bytesPerRow:896,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.scaleBy(x:0.2,y:0.2);surface.layer!.presentation()!.render(in:context)
    let pixels=context.data!.assumingMemoryBound(to:UInt8.self)
    let center=surface.revealCenter(lastVisible)
    let x=max(0,min(223,Int(center.x*0.2))),y=max(0,min(143,Int(center.y*0.2)))
    let alpha=pixels[((143-y)*224+x)*4+3]
    if progress<0.42{assert(alpha>250,"Background remains beneath the substantial part of the tile fade")}
    if progress>0.5 && opacity>0.01 && alpha<245{overlappingFrames+=1;firstOverlap=min(firstOverlap,progress)}
    intermediateTileFrames+=1
   }
   for (i,tile) in surface.pieces.enumerated() where now>fadeEnds[i]+0.025{
    assert((tile.presentation()?.opacity ?? 0)<0.01)
    assert(abs((tile.presentation()?.transform.m42 ?? 0)/surface.liftY)<0.3,"Landed tiles cannot rise again")
   }
  }
  assert(firstOverlap<0.75,"Background must visibly respond before the final quarter of the tile fade")
  assert(overlappingFrames>=2,"Actual pixels must reveal background while the final tile is still fading")
  assert(intermediateTileFrames>=3,"Do not compress the visible fade into a couple of frames")
  assert(partialBackground.count>=12,"Background diffusion must contain many intermediate frames")
  let spread=partialBackground.last!-partialBackground.first!
  assert(spread>=(cold ? 0.36:0.28),"Background diffusion must remain visible over time")
  let context=CGContext(data:nil,width:224,height:144,bitsPerComponent:8,bytesPerRow:896,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
  context.scaleBy(x:0.2,y:0.2);surface.layer!.presentation()!.render(in:context)
  let pixels=context.data!.assumingMemoryBound(to:UInt8.self)
  assert((0..<(224*144)).map{Int(pixels[$0*4+3])}.max()!<16,"Overlay must be clear before removal")
  print("first overlap phase",firstOverlap,"overlap frames",overlappingFrames,"visible frames",intermediateTileFrames,"background frames",partialBackground.count,"diffusion ms",spread*1000)
 }
 RunLoop.main.run(until:Date().addingTimeInterval(max(0,end-CACurrentMediaTime())+0.1))

 assert(completed==1 && surface.superview==nil && surface.revealTimer==nil)
 assert(surface.pieces.allSatisfy{$0.animationKeys()==nil})
 window.close()
 print("PASS",cold ? "cold":"warm","loading",loading,"exit ms",(end-ready)*1000)
}
checkObliqueGeometry()
for loading in [0.12,0.7,2.6]{check(true,loading);check(false,loading)}
'''
with tempfile.TemporaryDirectory(prefix='journal-launch-test-') as directory:
    folder = Path(directory)
    swift = folder / 'main.swift'
    swift.write_text('import Cocoa\nimport QuartzCore\n' + source[start:end] + checks)
    executable = folder / 'launch-test'
    cache = os.environ.get('JOURNAL_SWIFT_MODULE_CACHE', str(folder / 'module-cache'))
    subprocess.run(['swiftc', '-O', '-Xfrontend', '-assert-config', '-Xfrontend', 'Debug', '-module-cache-path', cache, str(swift), '-o', str(executable)], check=True)
    subprocess.run([str(executable)], check=True, timeout=60)
