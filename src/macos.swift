import Cocoa
import WebKit
import JavaScriptCore
import UniformTypeIdentifiers
import CoreText
import QuartzCore

// Device-local diagnostics: no project names, document paths, or activity content.
final class JournalStartupTiming {
 let began=ProcessInfo.processInfo.systemUptime
 let launchID=UUID().uuidString
 let file:URL
 let source:String
 let windowMode:String
 var recorded=Set<String>()
 init(directory:URL?=nil,source:String="coldStart",windowMode:String="newWindow"){
  self.source=source;self.windowMode=windowMode
  let base=Bundle.main.bundleURL.deletingLastPathComponent()
  let home=directory ?? (Bundle.main.object(forInfoDictionaryKey:"JournalAutomationHome") as? String).map{URL(fileURLWithPath:$0)} ?? base.appendingPathComponent("local/macos")
  file=home.appendingPathComponent("startup-times.jsonl")
  mark(["coldStart","backgroundStart"].contains(source) ? "mainStarted":"openRequested")
 }
 func mark(_ event:String,page:String?=nil,pageMS:Double?=nil){
  guard recorded.insert(event).inserted else{return}
  var row:[String:Any]=["launchID":launchID,"at":ISO8601DateFormatter().string(from:Date()),"pid":ProcessInfo.processInfo.processIdentifier,"event":event,"source":source,"windowMode":windowMode,"elapsedMs":((ProcessInfo.processInfo.systemUptime-began)*1000).rounded()]
  if let page=page,["page-review","page-projects","page-auto","page-settings"].contains(page){row["page"]=page}
  if let ms=pageMS,ms.isFinite,ms>=0{row["pageMs"]=ms.rounded()}
  do{
   try FileManager.default.createDirectory(at:file.deletingLastPathComponent(),withIntermediateDirectories:true)
   var previous=(try? Data(contentsOf:file)) ?? Data()
   if previous.count>262144{previous=Data(previous.split(separator:10).suffix(500).flatMap{Array($0)+[10]})}
   previous.append(try JSONSerialization.data(withJSONObject:row,options:.sortedKeys));previous.append(10)
   try previous.write(to:file,options:.atomic)
  }catch{/* Diagnostics must never prevent the app from opening. */}
 }
}

// Native tile layers, with one small shared alpha image during the reveal.
final class JournalLaunchSurface:NSView {
 let tiles=CALayer()
 let artwork=CALayer()
 let backdrop=CAGradientLayer()
 let light=CAGradientLayer()
 let cold:Bool
 let began=CACurrentMediaTime()
 let reduceMotion=NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
 var finishing=false
 var pieces:[CALayer]=[]
 var waveStarts:[CFTimeInterval]=[]
 struct RevealPlan{
  let index:Int
  let begin:CFTimeInterval
  let duration:CFTimeInterval
  let times:[CFTimeInterval]
  let radii:[CGFloat]
  func radius(at time:CFTimeInterval)->CGFloat{
   guard time>begin else{return 0}
   guard time<times.last! else{return radii.last!}
   var upper=1
   while upper<times.count-1 && times[upper]<time{upper+=1}
   let fraction=CGFloat((time-times[upper-1])/(times[upper]-times[upper-1]))
   return radii[upper-1]+(radii[upper]-radii[upper-1])*fraction
  }
 }
 var revealMasks:[CALayer]=[]
 var revealPlans:[RevealPlan]=[]
 var revealTimer:Timer?
 var revealGray:CGContext?
 var revealRGBA:CGContext?
 // A reusable soft rounded-square field, drawn in the same oblique plane
 // as the tiles. One image per source keeps each frame inexpensive.
 let revealTexture:CGImage={
  let context=CGContext(data:nil,width:256,height:256,bitsPerComponent:8,bytesPerRow:0,space:CGColorSpaceCreateDeviceGray(),bitmapInfo:CGImageAlphaInfo.none.rawValue)!
  context.setFillColor(CGColor(gray:1,alpha:1));context.fill(CGRect(x:0,y:0,width:256,height:256))
  for step in stride(from:128,through:0,by:-1){
   let t=CGFloat(step)/128,extent=128*(0.45+0.55*t)
   context.setFillColor(CGColor(gray:t*t*(3-2*t),alpha:1))
   let rect=CGRect(x:128-extent,y:128-extent,width:2*extent,height:2*extent)
   let corner=extent*30/155
   context.addPath(CGPath(roundedRect:rect,cornerWidth:corner,cornerHeight:corner,transform:nil));context.fillPath()
  }
  return context.makeImage()!
 }()
 var revealSources:[Int]=[]
 var revealOuterRadius:CGFloat=1
 let restingOpacity:Float=0.28
 let crestOpacity:Float=0.64
 var wavePeriod:CFTimeInterval{cold ? 1.6:1.0}
 var initialPhase:Double{cold ? 0.48:1.0}
 var phaseGap:Double{cold ? 0.08:0.13}
 // One shared sweep includes every diagonal before the leading tile can rise again.
 var waveCycleDuration:CFTimeInterval{wavePeriod*(1+8*phaseGap)}
 let liftX=sin(31 * Double.pi/180)/cos(52 * Double.pi/180)
 let liftY=cos(31 * Double.pi/180)/cos(52 * Double.pi/180)
 init(frame:NSRect,cold:Bool){
  self.cold=cold;super.init(frame:frame)
  autoresizingMask=[.width,.height];wantsLayer=true;layer?.masksToBounds=true
  setAccessibilityElement(true);setAccessibilityRole(.progressIndicator);setAccessibilityLabel("正在打开")
  func color(_ r:CGFloat,_ g:CGFloat,_ b:CGFloat,_ a:CGFloat=1)->CGColor{
   let dark=NSApp.effectiveAppearance.bestMatch(from:[.darkAqua,.aqua]) == .darkAqua
   let target=journalAccentHue()
   if !dark && target==148{return NSColor(calibratedRed:r,green:g,blue:b,alpha:a).cgColor}
   let hue=dark ? target:journalRotatedHue(r,g,b,target:target)
   let source=(max(r,g,b)+min(r,g,b))/2
   let level=dark ? (source>0.65 ? 0.12+(1-source)*0.5:0.04):source
   let spread=max(r,g,b)-min(r,g,b)
   let referenceSaturation:CGFloat=dark ? 0.045:(spread==0 ? 0:spread/(1-abs(2*source-1)))
   let preset = !["fern","custom"].contains(UserDefaults.standard.string(forKey:"JournalAccent") ?? "fern");let saturation:CGFloat = !dark && preset ? min(0.14,referenceSaturation*0.65):referenceSaturation
   let brightness=level+saturation*min(level,1-level)
   return NSColor(calibratedHue:hue/360,saturation:brightness>0 ? 2*(1-level/brightness):0,brightness:brightness,alpha:dark && a<1 ? a*0.15:a).cgColor
  }
  backdrop.colors=[color(0.9833,0.9882,0.9804),color(0.9333,0.9529,0.9216),color(0.9263,0.9486,0.9125)];backdrop.startPoint=CGPoint(x:0.2,y:1);backdrop.endPoint=CGPoint(x:0.85,y:0)
  layer?.addSublayer(backdrop);layer?.addSublayer(artwork);artwork.addSublayer(tiles)
  artwork.opacity=1
  tiles.bounds=CGRect(x:0,y:0,width:1726,height:1726)
  for row in 0..<5 {for column in 0..<5 {
   let tile=CALayer();tile.frame=CGRect(x:column*354,y:row*354,width:310,height:310);tile.opacity=0.48
   tile.shadowColor=color(0.38,0.46,0.35);tile.shadowOpacity=0.14;tile.shadowRadius=14;tile.shadowOffset=CGSize(width:8,height:-10)
   tile.shadowPath=CGPath(roundedRect:tile.bounds,cornerWidth:30,cornerHeight:30,transform:nil)
   let edge=CAGradientLayer();edge.frame=tile.bounds.offsetBy(dx:0,dy:-4);edge.cornerRadius=30;edge.colors=[color(0.88,0.93,0.84),color(0.80,0.86,0.74)];edge.startPoint=CGPoint(x:0,y:1);edge.endPoint=CGPoint(x:1,y:0)
   let face=CAGradientLayer();face.frame=tile.bounds;face.cornerRadius=30;face.colors=[color(0.9404,0.9608,0.9155),color(220.0/255,232.0/255,211.0/255)];face.startPoint=CGPoint(x:0.08,y:1);face.endPoint=CGPoint(x:0.95,y:0.12)
   face.borderColor=color(1,1,1,0.42);face.borderWidth=1
   tile.addSublayer(edge);tile.addSublayer(face);tiles.addSublayer(tile);pieces.append(tile)
   // Keep diagonal phases unwrapped: adjacent tiles belong to the same sweep.
   let age=(initialPhase-Double(row+column)*phaseGap)*wavePeriod
   let waveStart=began-age
   waveStarts.append(waveStart)
   if !reduceMotion {
    // Keep the same visible travel on warm opens, with a smooth continuous wave.
    let travel:CGFloat=11
    let riseDuration=wavePeriod
    let rise=CAKeyframeAnimation(keyPath:"transform");rise.values=[NSValue(caTransform3D:CATransform3DIdentity),NSValue(caTransform3D:CATransform3DMakeTranslation(liftX*travel,liftY*travel,0)),NSValue(caTransform3D:CATransform3DIdentity)];rise.keyTimes=[0,0.5,1]
    let mist=CAKeyframeAnimation(keyPath:"opacity");mist.values=[restingOpacity,crestOpacity,crestOpacity,restingOpacity];mist.keyTimes=[0,0.5,0.805,1]
    let ease=CAMediaTimingFunction(controlPoints:0.37,0,0.63,1)
    rise.timingFunctions=[ease,ease];mist.timingFunctions=[ease,CAMediaTimingFunction(name:.linear),ease];rise.duration=riseDuration;mist.duration=riseDuration
    rise.fillMode = .forwards;rise.isRemovedOnCompletion=false;mist.fillMode = .forwards;mist.isRemovedOnCompletion=false
    let wave=CAAnimationGroup();wave.animations=[rise,mist];wave.duration=waveCycleDuration;wave.beginTime=waveStart;wave.fillMode = .both;wave.isRemovedOnCompletion=false;wave.repeatCount = .infinity
    tile.add(wave,forKey:"ripple")
   }
  }}
  light.colors=[color(1,1,0.98,0.28),color(1,1,0.98,0)];light.startPoint=CGPoint(x:0.2,y:1);light.endPoint=CGPoint(x:0.7,y:0.2);layer?.addSublayer(light)
 }
 required init?(coder:NSCoder){fatalError("init(coder:) has not been implemented")}
 deinit{revealTimer?.invalidate()}
 override func layout(){
  super.layout();CATransaction.begin();CATransaction.setDisableActions(true)
  backdrop.frame=bounds;artwork.frame=bounds;light.frame=bounds
  tiles.position=CGPoint(x:bounds.midX,y:bounds.midY-10)
  // An oblique projection gives the same relief appearance without a 3D scene renderer.
  let scale=max(bounds.width/1024,bounds.height/710)*1.05
  let angle=31 * Double.pi/180,tilt=52 * Double.pi/180
  tiles.setAffineTransform(CGAffineTransform(a:cos(angle)*scale,b:sin(angle)*cos(tilt)*scale,c:-sin(angle)*scale,d:cos(angle)*cos(tilt)*scale,tx:0,ty:0))
  layoutRevealMasks()
  CATransaction.commit()
 }
 func revealCenter(_ index:Int)->CGPoint{
  let center=tiles.convert(pieces[index].position,to:layer)
  let visible=tiles.convert(pieces[index].frame,to:layer).intersection(bounds)
  // Edge tiles may have their geometric center outside the window. Open
  // from the visible portion, so their diffusion doesn't arrive off-screen.
  if !bounds.contains(center),!visible.isNull,!visible.isEmpty{return CGPoint(x:visible.midX,y:visible.midY)}
  return center
 }
 func revealProjection()->CGAffineTransform{
  var transform=tiles.affineTransform()
  transform.tx=tiles.position.x-transform.a*tiles.bounds.midX-transform.c*tiles.bounds.midY
  transform.ty=tiles.position.y-transform.b*tiles.bounds.midX-transform.d*tiles.bounds.midY
  return transform
 }
 func layoutRevealMasks(){
  guard !revealSources.isEmpty,bounds.width>0,bounds.height>0 else{return}
  let inverse=revealProjection().inverted()
  let centers=revealSources.map{revealCenter($0).applying(inverse)}
  // Cover every point, including corners and gaps, with at least one clear core.
  // The grid's half-diagonal bounds the distance between its samples.
  var reach:CGFloat=0
  for y in 0...8{for x in 0...8{
   let point=CGPoint(x:bounds.minX+bounds.width*CGFloat(x)/8,y:bounds.minY+bounds.height*CGFloat(y)/8)
   let local=point.applying(inverse)
   reach=max(reach,centers.map{hypot($0.x-local.x,$0.y-local.y)}.min()!)
  }}
  let sampleMargin=(hypot(inverse.a,inverse.b)*bounds.width+hypot(inverse.c,inverse.d)*bounds.height)/16
  let core=reach+sampleMargin+16
  let radius=core/0.45
  revealOuterRadius=radius
  for mask in revealMasks{mask.frame=bounds}
 }
 // Merge oblique rounded-square fields by their strongest contribution. Multiplying
 // dozens of overlapping alpha masks erased everything in a few frames.
 // A small shared image also avoids a deep full-window compositing chain.
 func updateRevealMask(at time:CFTimeInterval){
  guard !revealPlans.isEmpty,bounds.width>0,bounds.height>0 else{return}
  let scale=min(320/bounds.width,320/bounds.height)
  let width=max(1,Int(ceil(bounds.width*scale))),height=max(1,Int(ceil(bounds.height*scale)))
  if revealGray?.width != width || revealGray?.height != height{
   revealGray=CGContext(data:nil,width:width,height:height,bitsPerComponent:8,bytesPerRow:0,space:CGColorSpaceCreateDeviceGray(),bitmapInfo:CGImageAlphaInfo.none.rawValue)
   revealRGBA=CGContext(data:nil,width:width,height:height,bitsPerComponent:8,bytesPerRow:0,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)
  }
  guard let gray=revealGray,let rgba=revealRGBA else{return}
  gray.saveGState();gray.setBlendMode(.copy);gray.setFillColor(CGColor(gray:1,alpha:1))
  gray.fill(CGRect(x:0,y:0,width:width,height:height))
  gray.scaleBy(x:CGFloat(width)/bounds.width,y:CGFloat(height)/bounds.height)
  let projection=revealProjection(),inverse=projection.inverted()
  gray.concatenate(projection);gray.interpolationQuality = .low
  gray.setBlendMode(.darken)
  for plan in revealPlans where time>plan.begin{
   let radius=plan.radius(at:time)*revealOuterRadius
   guard radius>0.5 else{continue}
   let center=revealCenter(plan.index).applying(inverse)
   gray.setAlpha(min(1,CGFloat((time-plan.begin)/0.12)))
   gray.draw(revealTexture,in:CGRect(x:center.x-radius,y:center.y-radius,width:2*radius,height:2*radius))
  }
  gray.restoreGState()
  let input=gray.data!.assumingMemoryBound(to:UInt8.self),output=rgba.data!.assumingMemoryBound(to:UInt8.self)
  for y in 0..<height{for x in 0..<width{
   let offset=y*rgba.bytesPerRow+x*4
   output[offset]=0;output[offset+1]=0;output[offset+2]=0;output[offset+3]=input[y*gray.bytesPerRow+x]
  }}
  if let image=rgba.makeImage(){
   CATransaction.begin();CATransaction.setDisableActions(true)
   for mask in revealMasks{mask.contents=image}
   CATransaction.commit()
  }
 }
 func finish(_ completion:@escaping()->Void){
  guard !finishing else{return};finishing=true
  if reduceMotion{pieces.forEach{$0.removeAllAnimations()};removeFromSuperview();completion();return}
  let now=CACurrentMediaTime(),half=wavePeriod/2
  // With this easing, 61% of descent time is approximately two thirds of its travel.
  let fadePoint=half+half*0.61
  let sweep=floor(max(0,now-waveStarts[0])/waveCycleDuration)
  let projectedRects=pieces.map{tiles.convert($0.frame,to:layer).insetBy(dx:-12,dy:-12)}
  revealSources=pieces.indices.filter{bounds.intersects(projectedRects[$0])}
  let firstVisibleDiagonal=revealSources.map{$0/5+$0%5}.min() ?? 0
  CATransaction.begin();CATransaction.setDisableActions(true)
  for (i,tile) in pieces.enumerated(){
   // A longer background diffusion must not restart an already landed tile.
   if let wave=tile.animation(forKey:"ripple")?.copy() as? CAAnimation{
    wave.repeatCount=Float(sweep+1);tile.add(wave,forKey:"ripple")
   }
   // Finish this shared sweep, including tiles that have already landed. Never
   // wrap an early diagonal into the following sweep while later ones fade.
   let elapsed=now-(waveStarts[i]+sweep*waveCycleDuration)
   let reachedFadePoint=elapsed>=fadePoint
   let naturalWait=max(0,fadePoint-elapsed)
   let visible=revealSources.contains(i)
   let stagger=visible ? Double(max(0,i/5+i%5-firstVisibleDiagonal))*0.08:0
   let wait=max(naturalWait,stagger)
   let remainingFall=max(0,wavePeriod-max(elapsed,fadePoint))
   let duration=visible ? max(cold ? 0.44:0.33,min(0.32,remainingFall)):min(0.32,remainingFall)
   let opacity=reachedFadePoint ? (tile.presentation()?.opacity ?? tile.opacity):crestOpacity
   let fade=CABasicAnimation(keyPath:"opacity");fade.fromValue=opacity;fade.toValue=0
   fade.beginTime=now+wait;fade.duration=max(0.001,duration);fade.timingFunction=CAMediaTimingFunction(name:.easeInEaseOut)
   // The ripple rests flat after its descent until the next shared sweep.
   // Visible tiles retain a readable fade even if loading ends after they land.
   fade.fillMode = .forwards;fade.isRemovedOnCompletion=false;tile.opacity=0;tile.add(fade,forKey:"fallingFade")
  }
  layoutRevealMasks()
  let fades=pieces.map{$0.animation(forKey:"fallingFade")!}
  // Retain the background during the substantial part of each tile's fade,
  // then allow the local dissolve to overlap its disappearing tail.
  let protectionEnds=fades.map{$0.beginTime+$0.duration*0.5}
  let inverse=revealProjection().inverted()
  let protectedRects=revealSources.map{pieces[$0].frame.insetBy(dx:-12,dy:-12)}
  let protectedUntil=revealSources.map{protectionEnds[$0]}
  let diffusion:CFTimeInterval=cold ? 0.62:0.5
  let revealEnd=protectedUntil.max()!+diffusion
  for index in revealSources{
    // Prepare the local dissolve early in the tile fade, with a short
    // protection overlap so the center opens as the tile's tail disappears.
    let begin=fades[index].beginTime+fades[index].duration*0.35
    let duration=revealEnd-begin,center=revealCenter(index).applying(inverse)
    // Protect tiles through the first half of their fade. Exact release
    // boundaries keep earlier regions from cutting across a still-solid tile.
    var times=(0...80).map{begin+duration*Double($0)/80}
    times += protectedUntil.filter{$0>begin && $0<revealEnd}
    times=Array(Set(times)).sorted()
    var previousTime=begin,previousRadius:CGFloat=0
    let speed=revealOuterRadius/diffusion
    var radii:[CGFloat]=[]
    for time in times{
     var safeRadius=revealOuterRadius
     for (rect,end) in zip(protectedRects,protectedUntil) where time<=end+0.000001{
      let dx=max(rect.minX-center.x,0,center.x-rect.maxX)
      let dy=max(rect.minY-center.y,0,center.y-rect.maxY)
      safeRadius=min(safeRadius,max(dx,dy))
     }
     let radius=min(safeRadius,previousRadius+speed*max(0,time-previousTime))
     radii.append(radius/revealOuterRadius);previousRadius=radius;previousTime=time
    }
    revealPlans.append(RevealPlan(index:index,begin:begin,duration:duration,times:times,radii:radii))
  }
  for surface in [backdrop,light]{
   let mask=CALayer();mask.frame=bounds;mask.contentsGravity = .resize;mask.magnificationFilter = .linear
   surface.mask=mask;revealMasks.append(mask)
  }
  layoutRevealMasks()
  CATransaction.commit()
  updateRevealMask(at:now)
  let timer=Timer(timeInterval:1.0/60,repeats:true){[weak self] timer in
   guard let self=self else{timer.invalidate();return}
   let time=CACurrentMediaTime()
   self.updateRevealMask(at:time)
   // Use the same frame clock for drawing and removal, retaining the fully
   // transparent image for two frames before releasing the surface.
   if time>=revealEnd+1.0/30{
    timer.invalidate();self.revealTimer=nil
    self.pieces.forEach{$0.removeAllAnimations()}
    self.removeFromSuperview();completion()
   }
  }
  revealTimer=timer;RunLoop.main.add(timer,forMode:.common)
 }
 override func hitTest(_ point:NSPoint)->NSView?{nil}
}

// Center the actual Chinese glyph bounds, rather than NSTextField's line box.
final class JournalTitleContainer: NSView {
 override func hitTest(_ point:NSPoint)->NSView? {let hit=super.hitTest(point);return hit is JournalTitleText ? hit:nil}
}
final class JournalWindowDragView:NSView {
 var excludedAreas:[NSRect]=[]
 override func hitTest(_ point:NSPoint)->NSView? {
  let local=convert(point,from:superview)
  guard bounds.contains(local) else{return nil}
  // The aligned buttons can extend beyond their original titlebar parent's
  // bounds. Route their visible hit areas directly to AppKit before testing
  // the drag exclusions; returning nil would lose these clicks upstream.
  if let window=window {
   for type in [NSWindow.ButtonType.closeButton,.miniaturizeButton,.zoomButton] {
    if let button=window.standardWindowButton(type),button.window === window,
       !button.isHidden,button.isEnabled,
       button.bounds.contains(button.convert(local,from:self)) {return button}
   }
  }
  guard bounds.insetBy(dx:5,dy:3).contains(local),!excludedAreas.contains(where:{$0.contains(local)}) else{return nil}
  return self
 }
 override func mouseDown(with event:NSEvent){window?.performDrag(with:event)}
}

final class JournalTitleText: NSView {
 override func mouseDown(with event:NSEvent){window?.performDrag(with:event)}
 override func draw(_ dirtyRect:NSRect){
  guard let context=NSGraphicsContext.current?.cgContext else{return}
  let font=NSFont(name:"Songti SC",size:17) ?? NSFont.systemFont(ofSize:16,weight:.regular)
  let text=NSAttributedString(string:"项目手记",attributes:[.font:font,.foregroundColor:NSColor.labelColor])
  let line=CTLineCreateWithAttributedString(text)
  context.saveGState();context.textMatrix = .identity
  let ink=CTLineGetImageBounds(line,context)
  context.textPosition=CGPoint(x:-ink.minX,y:bounds.midY-ink.midY)
  CTLineDraw(line,context);context.restoreGState()
 }
}

// Menu views use semantic colors so the system material remains readable in either appearance.
private func journalAccentHue()->CGFloat {
 let accent=UserDefaults.standard.string(forKey:"JournalAccent") ?? "fern"
 if accent=="custom"{let value=UserDefaults.standard.object(forKey:"JournalCustomHue") as? Double ?? 148;return CGFloat(value.isFinite ? min(359,max(0,value.rounded())):148)}
 return ["fern":148,"slate":218,"iris":286,"clay":14,"sand":34,"rose":340,"macaron":334][accent] ?? 148
}
private func journalRotatedHue(_ r:CGFloat,_ g:CGFloat,_ b:CGFloat,target:CGFloat)->CGFloat {
 let upper=max(r,g,b),lower=min(r,g,b),spread=upper-lower
 var hue:CGFloat=0
 if spread>0{if upper==r{hue=((g-b)/spread).truncatingRemainder(dividingBy:6)*60}else if upper==g{hue=((b-r)/spread+2)*60}else{hue=((r-g)/spread+4)*60}}
 let accent=UserDefaults.standard.string(forKey:"JournalAccent") ?? "fern"
 if !["fern","custom"].contains(accent){return (target+((hue-110+540).truncatingRemainder(dividingBy:360)-180)*0.15+360).truncatingRemainder(dividingBy:360)}
 return (hue+target-148+720).truncatingRemainder(dividingBy:360)
}
private func journalAccentColor()->NSColor {
 if let hex=UserDefaults.standard.string(forKey:"JournalAccentSolid"),hex.range(of:"^#[0-9a-fA-F]{6}$",options:.regularExpression) != nil,let value=UInt32(hex.dropFirst(),radix:16){return NSColor(srgbRed:CGFloat((value>>16)&255)/255,green:CGFloat((value>>8)&255)/255,blue:CGFloat(value&255)/255,alpha:1)}
 if journalAccentHue()==148{return NSColor(srgbRed:49/255,green:92/255,blue:70/255,alpha:1)}
 let level:CGFloat=141/510,saturation:CGFloat=43/141,brightness=level+saturation*min(level,1-level)
 return NSColor(calibratedHue:journalRotatedHue(49/255,92/255,70/255,target:journalAccentHue())/360,saturation:2*(1-level/brightness),brightness:brightness,alpha:1)
}
private let journalMenuAccentFill = NSColor(name:nil){_ in journalAccentColor()}
private let journalMenuGreen = NSColor(name:nil){appearance in
 let color=journalAccentColor()
 return appearance.bestMatch(from:[.darkAqua,.aqua]) == .darkAqua ? color.blended(withFraction:0.48,of:.white) ?? color:color
}
private func journalApplyNativeAppearance(){
 switch UserDefaults.standard.string(forKey:"JournalColorScheme") ?? "system" {
 case "light":NSApp.appearance=NSAppearance(named:.aqua)
 case "dark":NSApp.appearance=NSAppearance(named:.darkAqua)
 default:NSApp.appearance=nil
 }
}
private let journalMenuMuted = NSColor(name:nil){appearance in
 appearance.bestMatch(from:[.darkAqua,.aqua]) == .darkAqua ? NSColor.white.withAlphaComponent(0.48):NSColor.black.withAlphaComponent(0.42)
}
private func journalMenuSymbol(_ name:String,_ size:CGFloat=14)->NSImage? {
 NSImage(systemSymbolName:name,accessibilityDescription:nil)?.withSymbolConfiguration(.init(pointSize:size,weight:.semibold))
}
// SF Symbols carry text-baseline alignment metadata. Center the visible mask,
// then lift it half a point for optical alignment with neighboring menu items.
private func journalStatusBarImage()->NSImage? {
 guard let symbol=NSImage(systemSymbolName:"square.grid.3x3.fill",accessibilityDescription:"项目手记"),let data=symbol.tiffRepresentation,let bitmap=NSBitmapImageRep(data:data) else{return NSImage(systemSymbolName:"square.grid.3x3.fill",accessibilityDescription:"项目手记")}
 var minX=bitmap.pixelsWide,minY=bitmap.pixelsHigh,maxX = -1,maxY = -1
 for y in 0..<bitmap.pixelsHigh {for x in 0..<bitmap.pixelsWide {if (bitmap.colorAt(x:x,y:y)?.alphaComponent ?? 0)>0.05 {minX=min(minX,x);maxX=max(maxX,x);minY=min(minY,y);maxY=max(maxY,y)}}}
 guard maxX>=minX,maxY>=minY else{return symbol}
 let px=CGFloat(bitmap.pixelsWide)/symbol.size.width,py=CGFloat(bitmap.pixelsHigh)/symbol.size.height
 let ink=NSRect(x:CGFloat(minX)/px,y:CGFloat(bitmap.pixelsHigh-maxY-1)/py,width:CGFloat(maxX-minX+1)/px,height:CGFloat(maxY-minY+1)/py)
 let factor=14/max(ink.width,ink.height),canvas=NSSize(width:18,height:18)
 let image=NSImage(size:canvas,flipped:false){rect in
  symbol.draw(in:NSRect(x:rect.midX-ink.midX*factor,y:rect.midY-ink.midY*factor+0.5,width:symbol.size.width*factor,height:symbol.size.height*factor));return true
 }
 image.alignmentRect=NSRect(origin:.zero,size:canvas);image.isTemplate=true;return image
}
// All menu glyphs share geometric centering and a 1.4 pt stroke.
private func journalMenuGlyphPath(_ name:String)->NSBezierPath {
 let p=NSBezierPath()
 switch name {
 case "tray":
  p.move(to:NSPoint(x:1,y:5));p.line(to:NSPoint(x:2.2,y:7.5));p.line(to:NSPoint(x:7.8,y:7.5));p.line(to:NSPoint(x:9,y:5));p.line(to:NSPoint(x:9,y:2.5));p.line(to:NSPoint(x:1,y:2.5));p.close()
  p.move(to:NSPoint(x:1,y:5));p.line(to:NSPoint(x:3,y:5));p.line(to:NSPoint(x:3.8,y:3.8));p.line(to:NSPoint(x:6.2,y:3.8));p.line(to:NSPoint(x:7,y:5));p.line(to:NSPoint(x:9,y:5))
 case "flag":
  p.move(to:NSPoint(x:4,y:1));p.line(to:NSPoint(x:2,y:9));p.line(to:NSPoint(x:8,y:9));p.line(to:NSPoint(x:6.5,y:6));p.line(to:NSPoint(x:2.75,y:6))
 case "pause":
  for x:CGFloat in [3.2,6.8]{p.move(to:NSPoint(x:x,y:2.1));p.line(to:NSPoint(x:x,y:7.9))}
 case "play":
  p.move(to:NSPoint(x:3,y:2));p.line(to:NSPoint(x:7,y:5));p.line(to:NSPoint(x:3,y:8));p.close()
 case "exclamationmark":
  p.move(to:NSPoint(x:5,y:4.2));p.line(to:NSPoint(x:5,y:8));p.move(to:NSPoint(x:5,y:2));p.line(to:NSPoint(x:5,y:2.01))
 default:
  p.appendOval(in:NSRect(x:1,y:1,width:8,height:8));p.move(to:NSPoint(x:5,y:7.5));p.line(to:NSPoint(x:5,y:5));p.line(to:NSPoint(x:3,y:5))
 }
 return p
}
private func journalMenuGlyph(_ name:String,_ size:CGFloat=10,_ color:NSColor = .labelColor)->NSImage {
 NSImage(size:NSSize(width:size,height:size),flipped:false){rect in
  let path=journalMenuGlyphPath(name)
  path.transform(using:AffineTransform(scale:size/10))
  path.transform(using:AffineTransform(translationByX:rect.midX-path.bounds.midX,byY:rect.midY-path.bounds.midY))
  path.lineWidth=1.4;path.lineCapStyle = .round;path.lineJoinStyle = .round;color.setStroke();path.stroke();return true
 }
}
final class JournalMenuDividerView:NSView {
 override var allowsVibrancy:Bool{false}
 override func draw(_ dirtyRect:NSRect){
  let dark=effectiveAppearance.bestMatch(from:[.darkAqua,.aqua]) == .darkAqua
  let color=dark ? NSColor(srgbRed:0.26,green:0.26,blue:0.25,alpha:1):NSColor(srgbRed:228.0/255,green:227.0/255,blue:224.0/255,alpha:1)
  let scale=window?.backingScaleFactor ?? 2
  color.setFill();NSRect(x:16,y:floor(bounds.midY*scale)/scale,width:bounds.width-32,height:1/scale).fill()
 }
}
private func journalMenuDivider()->NSMenuItem {
 let item=NSMenuItem();item.isEnabled=false;item.view=JournalMenuDividerView(frame:NSRect(x:0,y:0,width:260,height:8));return item
}
private func journalPendingMenuTitle(_ count:Int)->NSAttributedString {
 let image=NSImage(size:NSSize(width:20,height:20),flipped:false){rect in
  let circle=NSBezierPath(ovalIn:rect.insetBy(dx:0.7,dy:0.7));journalMenuAccentFill.setFill();circle.fill()
  journalMenuGlyph("exclamationmark",10,.white).draw(in:NSRect(x:5,y:5,width:10,height:10));return true
 }
 let attachment=NSTextAttachment();attachment.image=image;attachment.bounds=NSRect(x:0,y:-5,width:20,height:20)
 let text=NSMutableAttributedString(attachment:attachment)
 text.append(NSAttributedString(string:"  待处理建议",attributes:[.font:NSFont.systemFont(ofSize:12,weight:.medium),.foregroundColor:NSColor.labelColor]))
 text.append(NSAttributedString(string:"\t\(count) 天",attributes:[.font:NSFont.systemFont(ofSize:10),.foregroundColor:journalMenuGreen]))
 let paragraph=NSMutableParagraphStyle();paragraph.tabStops=[NSTextTab(textAlignment:.right,location:195)];paragraph.defaultTabInterval=195
 text.addAttribute(.paragraphStyle,value:paragraph,range:NSRange(location:0,length:text.length));return text
}
final class JournalMenuSummaryView:NSView {
 let timeLabel=NSTextField(labelWithString:"正在读取…")
 let detailLabel=NSTextField(labelWithString:"")
 let dateLabel=NSTextField(labelWithString:"")
 let caption=NSTextField(labelWithString:"今日投入")
 let icon=NSImageView()
 override init(frame:NSRect){
  super.init(frame:frame)
  caption.font = .systemFont(ofSize:11,weight:.medium);caption.textColor = .secondaryLabelColor
  icon.image=journalMenuGlyph("clock",14,.secondaryLabelColor);icon.contentTintColor = .secondaryLabelColor
  dateLabel.font = .systemFont(ofSize:10,weight:.regular);dateLabel.textColor=journalMenuMuted;dateLabel.alignment = .right
  timeLabel.font = .monospacedDigitSystemFont(ofSize:30,weight:.semibold);timeLabel.textColor=journalMenuGreen
  detailLabel.font = .systemFont(ofSize:10);detailLabel.textColor = .secondaryLabelColor;detailLabel.isHidden=true
  for view in [caption,icon,dateLabel,timeLabel,detailLabel] as [NSView]{addSubview(view)}
  setAccessibilityElement(true);setAccessibilityRole(.staticText)
 }
 required init?(coder:NSCoder){fatalError("init(coder:) has not been implemented")}
 override func layout(){
  super.layout()
  let textY=bounds.height-24
  caption.frame=NSRect(x:40,y:textY,width:112,height:caption.fittingSize.height)
  dateLabel.frame=NSRect(x:164,y:textY,width:78,height:dateLabel.fittingSize.height)
  let baseline=caption.frame.minY+caption.lastBaselineOffsetFromBottom
  dateLabel.frame.origin.y=baseline+(caption.font?.capHeight ?? 8)/2-(dateLabel.font?.capHeight ?? 7)/2-dateLabel.lastBaselineOffsetFromBottom
  let opticalCenter=baseline+(caption.font?.capHeight ?? 8)/2
  icon.frame=NSRect(x:18,y:opticalCenter-7,width:14,height:14)
  timeLabel.frame=NSRect(x:16,y:detailLabel.isHidden ? 0:18,width:228,height:39)
  detailLabel.frame=NSRect(x:18,y:3,width:224,height:14)
 }
 func setDetail(_ text:String){
  detailLabel.stringValue=text;detailLabel.isHidden=text.isEmpty
  setFrameSize(NSSize(width:260,height:text.isEmpty ? 72:90));needsLayout=true
 }
 func setTime(hours:Int,minutes:Int){
  let text=NSMutableAttributedString(string:"")
  func append(_ value:String,_ size:CGFloat,_ weight:NSFont.Weight,_ color:NSColor){let base=NSFont.systemFont(ofSize:size,weight:weight);let font=size>=30 ? NSFont(descriptor:base.fontDescriptor.withDesign(.rounded) ?? base.fontDescriptor,size:size) ?? base:base;text.append(NSAttributedString(string:value,attributes:[.font:font,.foregroundColor:color]))}
  if hours>0{append("\(hours)",30,.semibold,journalMenuGreen);append(" 小时  ",12,.medium,.secondaryLabelColor)}
  append("\(minutes)",30,.semibold,journalMenuGreen);append(" 分钟",12,.medium,.secondaryLabelColor)
  timeLabel.attributedStringValue=text
  let formatter=DateFormatter();formatter.locale=Locale(identifier:"zh_CN");formatter.dateFormat="M月d日";dateLabel.stringValue=formatter.string(from:Date())
  setAccessibilityLabel("今日投入，\(hours)小时\(minutes)分钟。\(detailLabel.stringValue)")
 }
}
final class JournalMenuInfoView:NSView {
 let titleLabel=NSTextField(labelWithString:"")
 let detailLabel=NSTextField(labelWithString:"")
 let icon=NSImageView()
 let control=NSButton()
 var isEmphasized=false
 var actionControl:NSButton?
 var toggleSymbol="pause"
 override init(frame:NSRect){
  super.init(frame:frame)
  titleLabel.font = .systemFont(ofSize:12,weight:.medium);titleLabel.textColor = .labelColor
  detailLabel.font = .systemFont(ofSize:10);detailLabel.alignment = .right;detailLabel.textColor=journalMenuMuted;detailLabel.lineBreakMode = .byTruncatingTail
  addSubview(titleLabel);addSubview(detailLabel);addSubview(icon)
  control.isHidden=true;control.title="";control.isTransparent=true;control.isBordered=false;control.imagePosition = .imageOnly;control.contentTintColor=journalMenuGreen;addSubview(control)
  setAccessibilityElement(true);setAccessibilityRole(.staticText)
 }
 convenience init(){self.init(frame:NSRect(x:0,y:0,width:260,height:24))}
 required init?(coder:NSCoder){fatalError("init(coder:) has not been implemented")}
 override func layout(){
  super.layout()
  let titleWidth=min(96,ceil(titleLabel.attributedStringValue.size().width)+2)
  titleLabel.frame=NSRect(x:40,y:(bounds.height-titleLabel.fittingSize.height)/2,width:titleWidth,height:titleLabel.fittingSize.height)
  let baseline=titleLabel.frame.minY+titleLabel.lastBaselineOffsetFromBottom
  detailLabel.frame=NSRect(x:40+titleWidth+8,y:baseline-detailLabel.lastBaselineOffsetFromBottom,width:194-titleWidth,height:detailLabel.fittingSize.height)
  icon.frame=NSRect(x:20,y:(bounds.height-10)/2,width:10,height:10)
  control.frame=NSRect(x:15,y:(bounds.height-20)/2,width:20,height:20)
 }
 func makeAction(target:AnyObject,action:Selector){let button=NSButton(frame:bounds);button.title="";button.isTransparent=true;button.isBordered=false;button.target=target;button.action=action;button.autoresizingMask=[.width,.height];button.isEnabled=false;button.toolTip="查看今天的截止节点";button.setAccessibilityLabel("查看今日截止");addSubview(button);actionControl=button;setAccessibilityElement(false)}
 func makeToggle(target:AnyObject,action:Selector){control.target=target;control.action=action;control.isHidden=false;icon.isHidden=true;setAccessibilityElement(false)}
 override func draw(_ dirtyRect:NSRect){
  let color=isEmphasized ? journalMenuGreen:NSColor.labelColor
  let circle=NSBezierPath(ovalIn:NSRect(x:15,y:(bounds.height-20)/2,width:20,height:20).insetBy(dx:0.7,dy:0.7))
  (isEmphasized ? journalMenuAccentFill:color.withAlphaComponent(0.07)).setFill();circle.fill()
  if !control.isHidden{journalMenuGlyph(toggleSymbol,10,isEmphasized ? .white:journalMenuMuted).draw(in:NSRect(x:20,y:(bounds.height-10)/2,width:10,height:10))}
 }
 func update(title:String,detail:String,symbol:String,color:NSColor,emphasized:Bool=false){isEmphasized=emphasized;titleLabel.stringValue=title;detailLabel.stringValue=detail;let inner=symbol=="flag" ? "flag":symbol=="tray" ? "tray":symbol=="exclamationmark.circle" ? "exclamationmark":"clock"
  let glyphColor=emphasized ? NSColor.white:color;icon.image=journalMenuGlyph(inner,10,glyphColor);icon.contentTintColor=glyphColor;control.contentTintColor=color;needsDisplay=true;setAccessibilityLabel(title+"，"+detail);actionControl?.setAccessibilityLabel("查看"+title+"，"+detail);needsLayout=true}
}

final class JournalApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler, NSMenuDelegate {
 var startupTiming:JournalStartupTiming?
 var openingTiming:JournalStartupTiming?
 let backgroundLaunch=CommandLine.arguments.contains("--background")
 var launchSurface:JournalLaunchSurface?
 var window: NSWindow!
 var titleDragArea:JournalWindowDragView?
 var headerControlRects:[NSRect]=[]
 var webView: WKWebView!
 var task: Process?
 var launchURL:URL?
 var observer:JournalObserver?
 var statusItem:NSStatusItem?
 var pendingCheckTimer:Timer?
 var pendingCheckInFlight=false
 var pendingHasResult=false
 var pendingRefreshTask:DispatchWorkItem?
 var reminderItem:NSMenuItem?
 var reminderGeneration=0
 var pendingReminderDate:String?
 var pendingReminderRange:[String:Any]?
 var dailySummaryTimer:Timer?
 var dailySummaryLoading=false
 var pendingTodayDeadlines=false
 var menuDeadlineInfo:JournalMenuInfoView?
 var menuSummary:JournalMenuSummaryView?
 var menuReminderInfo:JournalMenuInfoView?
 var menuTrackingInfo:JournalMenuInfoView?
 var trackingStatusItem:NSMenuItem?
 var trackingToggleItem:NSMenuItem?
 var loaded = false
 var terminating = false
 var outputBuffer = ""
 var startupTimer: Timer?
 func applicationDidFinishLaunching(_ notification: Notification) {
  journalApplyNativeAppearance()
  startupTiming?.mark("appLaunched")
  let menu = NSMenu(); let appItem = NSMenuItem(); menu.addItem(appItem)
  let appMenu = NSMenu();appMenu.addItem(withTitle:"关于项目手记", action:#selector(NSApplication.orderFrontStandardAboutPanel(_:)),keyEquivalent:"");appMenu.addItem(.separator());appMenu.addItem(withTitle:"隐藏项目手记",action:#selector(NSApplication.hide(_:)),keyEquivalent:"h");appMenu.addItem(withTitle:"退出项目手记",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q");appItem.submenu=appMenu
  let editItem=NSMenuItem();menu.addItem(editItem);let edit=NSMenu(title:"编辑");edit.addItem(withTitle:"撤销",action:#selector(undoJournal),keyEquivalent:"z");let redoItem=edit.addItem(withTitle:"重做",action:#selector(redoJournal),keyEquivalent:"z");redoItem.keyEquivalentModifierMask=[.command,.shift];edit.addItem(.separator());for (title,selector,key) in [("剪切","cut:","x"),("复制","copy:","c"),("粘贴","paste:","v"),("全选","selectAll:","a")]{edit.addItem(withTitle:title,action:NSSelectorFromString(selector),keyEquivalent:key)};editItem.submenu=edit;let windowItem=NSMenuItem();menu.addItem(windowItem);let windowMenu=NSMenu(title:"窗口");windowMenu.addItem(withTitle:"关闭窗口",action:#selector(NSWindow.performClose(_:)),keyEquivalent:"w");windowMenu.addItem(withTitle:"最小化",action:#selector(NSWindow.performMiniaturize(_:)),keyEquivalent:"m");windowItem.submenu=windowMenu;NSApp.windowsMenu=windowMenu;NSApp.mainMenu=menu
  if let iconURL=Bundle.main.url(forResource:"AppIcon",withExtension:"icns"){NSApp.applicationIconImage=NSImage(contentsOf:iconURL)}
  installStatusItem();if !backgroundLaunch{createWindow()}
  let bundle=Bundle.main.bundleURL;let base=bundle.deletingLastPathComponent();let nested=base.appendingPathComponent("项目手记/数据");let english=base.appendingPathComponent("data");let legacy=FileManager.default.fileExists(atPath:nested.path) ? nested : base.appendingPathComponent("数据");let data=FileManager.default.fileExists(atPath:english.path) || !FileManager.default.fileExists(atPath:legacy.path) ? english : legacy;let backend=Bundle.main.resourceURL!.appendingPathComponent("journal-core")
  let process=Process();process.executableURL=backend;process.arguments=["--no-open","--window-url","--data-dir",data.path,"--parent-pid",String(ProcessInfo.processInfo.processIdentifier)];if let home=Bundle.main.object(forInfoDictionaryKey:"JournalAutomationHome")as?String{process.arguments! += ["--auto-home",home]}else{let local=base.appendingPathComponent("local/macos");if FileManager.default.fileExists(atPath:local.path){process.arguments! += ["--auto-home",local.path]}};let output=Pipe();process.standardOutput=output;process.standardError=output;task=process
  output.fileHandleForReading.readabilityHandler={ [weak self] handle in let bytes=handle.availableData;if bytes.isEmpty{return};let str=String(data:bytes,encoding:.utf8) ?? "";DispatchQueue.main.async { self?.handleOutput(str) } }
  process.terminationHandler={ [weak self] _ in DispatchQueue.main.async { guard let self=self, !self.terminating else{return};if !self.loaded { self.showError(self.outputBuffer.isEmpty ? "本地程序未能启动。请检查软件文件是否完整。" : self.outputBuffer) } else { NSApp.terminate(nil) } } }
  startupTiming?.mark("backendStarted")
  do{try process.run()}catch{showError("无法启动本地程序：\(error.localizedDescription)")}
  startupTimer=Timer.scheduledTimer(withTimeInterval:20,repeats:false){ [weak self] _ in guard let self=self,!self.loaded else{return};self.showError("启动超时，请检查文件夹权限。\n\(self.outputBuffer)") }
 }
 func createWindow(){
  let config=WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent()
  config.userContentController.addUserScript(WKUserScript(source:"""
  (()=>{
   const deadline=performance.now()+120000;
   const ready=()=>{
    if(window.journalViewReady||document.querySelector('.error-banner')){requestAnimationFrame(()=>requestAnimationFrame(()=>window.webkit.messageHandlers.journalNative.postMessage({action:'startupReady',page:document.querySelector('main>section:not([hidden])')?.id||'',pageMs:performance.now()})));return}
    if(performance.now()<deadline)requestAnimationFrame(ready);
   };requestAnimationFrame(ready);
  })();
  """,injectionTime:.atDocumentStart,forMainFrameOnly:true))
  config.userContentController.addUserScript(WKUserScript(source:"window.journalMacHost = true",injectionTime:.atDocumentStart,forMainFrameOnly:true))
  let initialAppearance:[String:Any]=["scheme":UserDefaults.standard.string(forKey:"JournalColorScheme") ?? "system","accent":UserDefaults.standard.string(forKey:"JournalAccent") ?? "fern","hue":UserDefaults.standard.object(forKey:"JournalCustomHue") as? Double ?? 148]
  if let data=try? JSONSerialization.data(withJSONObject:initialAppearance),let json=String(data:data,encoding:.utf8){config.userContentController.addUserScript(WKUserScript(source:"window.journalInitialAppearance = "+json,injectionTime:.atDocumentStart,forMainFrameOnly:true))}
  config.userContentController.addUserScript(WKUserScript(source:"""
  document.documentElement.classList.add('native-mac');
  const journalMacStyle = document.createElement('link');
  journalMacStyle.rel = 'stylesheet'; journalMacStyle.href = 'macos.css';
  document.head.appendChild(journalMacStyle);
  """,injectionTime:.atDocumentEnd,forMainFrameOnly:true))
  config.userContentController.addUserScript(WKUserScript(source:"""
  (()=>{
   const sync=()=>{const rects=[...document.querySelectorAll('.workspace-nav,.workspace-actions')].map(el=>{const r=el.getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,height:r.height}});window.webkit.messageHandlers.journalNative.postMessage({action:'headerRegions',rects})};
   window.journalSyncHeaderDragRegions=sync;
   const observe=()=>{const observer=new ResizeObserver(sync);document.querySelectorAll('.workspace-header,.workspace-nav,.workspace-actions').forEach(el=>observer.observe(el));sync()};
   window.addEventListener('resize',sync);requestAnimationFrame(observe);
  })();
  """,injectionTime:.atDocumentEnd,forMainFrameOnly:true))
  config.userContentController.add(self,name:"journalNative")
  webView=WKWebView(frame:.zero,configuration:config);webView.navigationDelegate=self;webView.uiDelegate=self
  window=NSWindow(contentRect:NSRect(x:0,y:0,width:1120,height:720),styleMask:[.titled,.closable,.miniaturizable,.resizable,.fullSizeContentView],backing:.buffered,defer:false);window.isReleasedWhenClosed=false;window.title="项目手记";window.titleVisibility = .hidden;window.titlebarAppearsTransparent = true;window.backgroundColor = .windowBackgroundColor;webView.underPageBackgroundColor = .windowBackgroundColor;window.minSize=NSSize(width:740,height:560);window.isMovable=true;window.isMovableByWindowBackground=true;window.delegate=self;window.contentView=webView;
  let titleAccessory=NSTitlebarAccessoryViewController();titleAccessory.layoutAttribute = .left
  window.titlebarAppearsTransparent = true
  let titleView=JournalTitleContainer(frame:NSRect(x:0,y:0,width:165,height:38))
  let titleLabel=JournalTitleText(frame:NSRect(x:24,y:9,width:80,height:24));titleLabel.setAccessibilityElement(true);titleLabel.setAccessibilityRole(.staticText);titleLabel.setAccessibilityLabel("项目手记");titleView.addSubview(titleLabel)
  titleAccessory.view=titleView;window.addTitlebarAccessoryViewController(titleAccessory)
  let surface=JournalLaunchSurface(frame:webView.bounds,cold:openingTiming == nil);launchSurface=surface;webView.addSubview(surface)
  window.collectionBehavior=[.moveToActiveSpace,.fullScreenAuxiliary,.canJoinAllApplications]
  window.center();window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true);DispatchQueue.main.async { [weak self] in self?.alignTitlebar() }
  (openingTiming ?? startupTiming)?.mark("windowShown")

  if let url=launchURL{webView.load(URLRequest(url:url))}
 }
 func installStatusItem(){
  statusItem=NSStatusBar.system.statusItem(withLength:NSStatusItem.squareLength)
  if let button=statusItem?.button {
   button.image=journalStatusBarImage()
   button.imagePosition = .imageOnly
   button.toolTip="项目手记"
   button.title=""
  }
  let menu=NSMenu();menu.delegate=self;menu.minimumWidth=260
  menu.autoenablesItems=false
  let heading=NSMenuItem();let summary=JournalMenuSummaryView(frame:NSRect(x:0,y:0,width:260,height:72));heading.view=summary;menuSummary=summary;menu.addItem(heading);menu.addItem(journalMenuDivider())
  let deadlineItem=NSMenuItem();let deadlineInfo=JournalMenuInfoView();deadlineInfo.update(title:"今日截止",detail:"读取中…",symbol:"flag",color:journalMenuMuted);deadlineInfo.makeAction(target:self,action:#selector(openTodayDeadlines));deadlineItem.view=deadlineInfo;deadlineItem.isEnabled=true;menuDeadlineInfo=deadlineInfo;menu.addItem(deadlineItem)
  let reminder=NSMenuItem(title:"待处理建议",action:nil,keyEquivalent:"");let reminderInfo=JournalMenuInfoView();reminderInfo.update(title:"待处理建议",detail:"准备中…",symbol:"clock.arrow.circlepath",color:.secondaryLabelColor);reminder.view=reminderInfo;reminder.isEnabled=false;menuReminderInfo=reminderInfo;menu.addItem(reminder);reminderItem=reminder
  let state=NSMenuItem();let trackingInfo=JournalMenuInfoView();trackingInfo.update(title:"自动记录",detail:"读取中…",symbol:"record.circle",color:.secondaryLabelColor);state.view=trackingInfo;state.isEnabled=false;menuTrackingInfo=trackingInfo;menu.addItem(state);trackingStatusItem=state
  trackingInfo.makeToggle(target:self,action:#selector(toggleTracking));trackingInfo.control.isEnabled=false;trackingToggleItem=state

  menu.addItem(journalMenuDivider())
  let open=menu.addItem(withTitle:"打开项目手记",action:#selector(openJournal),keyEquivalent:"");open.target=self;open.image=journalMenuSymbol("macwindow")
  let quit=menu.addItem(withTitle:"退出项目手记",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"");quit.target=NSApp;quit.image=journalMenuSymbol("power")
  statusItem?.menu=menu
  let timer=Timer(timeInterval:30,repeats:true){[weak self] _ in self?.refreshDaySummary()};RunLoop.main.add(timer,forMode:.common);dailySummaryTimer=timer
  let pendingTimer=Timer(timeInterval:120,repeats:true){[weak self] _ in self?.refreshPendingSuggestions()};RunLoop.main.add(pendingTimer,forMode:.common);pendingCheckTimer=pendingTimer
 }
 func updatePendingDayCount(_ count:Int){
  guard let item=statusItem,let button=item.button else{return}
  let days=max(0,min(7,count));item.length=days>0 ? NSStatusItem.variableLength:NSStatusItem.squareLength
  button.imagePosition=days>0 ? .imageLeft:.imageOnly;button.font = .monospacedDigitSystemFont(ofSize:12,weight:.medium);button.title=days>0 ? " \(days)":""
  let label=days>0 ? "项目手记 · 近7天有\(days)天建议待划取":"项目手记"
  button.toolTip=label;button.setAccessibilityLabel(label)
 }
 func refreshDaySummary(){
  guard let observer=observer,!dailySummaryLoading else{return}
  let formatter=DateFormatter();formatter.locale=Locale(identifier:"en_US_POSIX");formatter.dateFormat="yyyy-MM-dd";let day=formatter.string(from:Date())
  var parts=URLComponents(url:observer.server.appendingPathComponent("api/auto/day-summary"),resolvingAgainstBaseURL:false)!;parts.queryItems=[URLQueryItem(name:"date",value:day)]
  var request=URLRequest(url:parts.url!,cachePolicy:.reloadIgnoringLocalCacheData);request.setValue(observer.token,forHTTPHeaderField:"X-Journal-Token");request.timeoutInterval=10;dailySummaryLoading=true
  URLSession.shared.dataTask(with:request){[weak self] data,response,error in
   DispatchQueue.main.async{
    guard let self=self else{return};self.dailySummaryLoading=false
    guard error==nil,(response as? HTTPURLResponse)?.statusCode==200,let data=data,let value=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],let hours=value["hours"] as? Double,formatter.string(from:Date())==day else{
     self.menuDeadlineInfo?.actionControl?.isEnabled=false;self.menuDeadlineInfo?.update(title:"今日截止",detail:"暂时无法读取",symbol:"flag",color:journalMenuMuted);self.menuSummary?.timeLabel.font = .systemFont(ofSize:18,weight:.medium);self.menuSummary?.timeLabel.stringValue="暂时无法读取";self.menuSummary?.setDetail("请稍后重试");self.menuSummary?.setAccessibilityLabel("今日投入暂时无法读取，请稍后重试");self.statusItem?.button?.toolTip="项目手记 · 今日总投入读取失败";return
    }
    let minutes=Int((hours*60).rounded()),h=minutes/60,m=minutes%60,missing=value["missing"] as? Int ?? 0,estimated=value["estimatedHours"] as? Double ?? 0
    self.menuSummary?.setDetail((estimated>0 ? "含估算投入":"")+(missing>0 ? (estimated>0 ? " · ":"")+"\(missing)条记录待配置":""))
    self.menuSummary?.setTime(hours:h,minutes:m)
    let due=max(0,value["dueToday"] as? Int ?? 0)
    self.menuDeadlineInfo?.actionControl?.isEnabled=due>0
    self.menuDeadlineInfo?.update(title:"今日截止",detail:due>0 ? "\(due) 个待完成":"暂无",symbol:"flag",color:due>0 ? journalMenuGreen:journalMenuMuted,emphasized:due>0)
   }
  }.resume()
 }
 func schedulePendingSuggestions(){
  pendingRefreshTask?.cancel();let task=DispatchWorkItem{[weak self] in self?.refreshPendingSuggestions()};pendingRefreshTask=task;DispatchQueue.main.asyncAfter(deadline:.now()+3,execute:task)
 }
 func refreshPendingSuggestions(){
  guard let observer=observer,!pendingCheckInFlight else{return}
  pendingCheckInFlight=true;reminderGeneration += 1;let generation=reminderGeneration
  if !pendingHasResult{menuReminderInfo?.update(title:"待处理建议",detail:"准备中…",symbol:"clock.arrow.circlepath",color:.secondaryLabelColor);reminderItem?.isEnabled=false}

  let formatter=DateFormatter();formatter.locale=Locale(identifier:"en_US_POSIX");formatter.dateFormat="yyyy-MM-dd"
  var parts=URLComponents(url:observer.server.appendingPathComponent("api/auto/timeline"),resolvingAgainstBaseURL:false)!;parts.queryItems=[URLQueryItem(name:"reminders",value:formatter.string(from:Date()))]
  var request=URLRequest(url:parts.url!,cachePolicy:.reloadIgnoringLocalCacheData);request.setValue(observer.token,forHTTPHeaderField:"X-Journal-Token");request.timeoutInterval=15
  URLSession.shared.dataTask(with:request){[weak self] data,response,error in
   var result:[[String:Any]]?;var incomplete=false
   if error==nil,(response as?HTTPURLResponse)?.statusCode==200,let data=data,let payload=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],let engine=payload["engine"] as? String,let context=JSContext(){
    context.evaluateScript(engine)
    if context.exception == nil,let value=context.objectForKeyedSubscript("pendingSuggestionDays")?.call(withArguments:[payload]),context.exception == nil {result=value.toArray() as? [[String:Any]]}
    incomplete = !(payload["warnings"] as? [String] ?? []).isEmpty
   }
   DispatchQueue.main.async{
    guard let self=self,generation==self.reminderGeneration,let item=self.reminderItem else{return}
    self.pendingCheckInFlight=false
    guard let days=result else{if !self.pendingHasResult{self.menuReminderInfo?.update(title:"待处理建议",detail:"稍后重试",symbol:"exclamationmark.circle",color:.systemOrange);item.isEnabled=false};return}
    self.pendingHasResult=true;self.updatePendingDayCount(days.count);item.representedObject=days.count;item.submenu=nil
    if days.isEmpty{item.attributedTitle=nil;item.setAccessibilityLabel(nil);item.view=self.menuReminderInfo;item.title="待处理建议";self.menuReminderInfo?.update(title:"待处理建议",detail:incomplete ? "部分线索待同步":"暂无",symbol:incomplete ? "arrow.triangle.2.circlepath":"tray",color:journalMenuMuted);item.isEnabled=false;return}
    item.view=nil;item.title="待处理建议";item.image=nil;item.attributedTitle=journalPendingMenuTitle(days.count);item.setAccessibilityLabel("待处理建议，\(days.count)天");item.toolTip="过去7天（不含今天）有\(days.count)天建议待划取"+(incomplete ? "，部分线索待同步":"");item.isEnabled=true
    let dates=NSMenu();dates.autoenablesItems=false
    for day in days {
     guard let date=day["date"] as? String else{continue};let count=day["count"] as? Int ?? 0,minutes=day["minutes"] as? Int ?? 0
     let entry=dates.addItem(withTitle:"\(date.suffix(5).replacingOccurrences(of:"-",with:"/")) · \(count)段 · \(minutes)分钟",action:nil,keyEquivalent:"")
     let ranges=NSMenu();ranges.autoenablesItems=false
     for slot in day["slots"] as? [[String:Any]] ?? [] {
      guard let start=slot["start"] as? Int,let end=slot["end"] as? Int,start>=0,end<=1440,start<end else{continue}
      let stamp:(Int)->String={String(format:"%02d:%02d",$0/60,$0%60)}
      let range=ranges.addItem(withTitle:"\(stamp(start))–\(stamp(end)) · \(end-start)分钟",action:#selector(self.openReminderDate(_:)),keyEquivalent:"")
      range.target=self;range.representedObject=["date":date,"start":start,"end":end,"projectId":slot["projectId"] as? String ?? ""]
     }
     entry.submenu=ranges

    }
    item.submenu=dates;self.statusItem?.menu?.update()
   }
  }.resume()
 }
 @objc func openReminderDate(_ item:NSMenuItem){guard let range=item.representedObject as? [String:Any],let date=range["date"] as? String else{return};pendingReminderDate=date;pendingReminderRange=range;showJournal(source:"statusBar")}
 func navigatePendingReminder(){
  guard let date=pendingReminderDate else{return};let range=pendingReminderRange ?? [:];pendingReminderDate=nil;pendingReminderRange=nil
  webView?.callAsyncJavaScript("return window.journalOpenTimelineDate ? await window.journalOpenTimelineDate(date,range) : false;",arguments:["date":date,"range":range],in:nil,in:.page,completionHandler:nil)
 }
 func updateTrackingMenu(_ state:[String:Any]){
  let enabled=state["enabled"]as?Bool ?? false,activity=state["activityEnabled"]as?Bool ?? false,status=state["status"]as?String ?? "正在读取"
  let listening=status=="监听中",paused=status=="已暂停",title="自动记录"
  let detail=listening ? (activity ? "文件与时长":"仅文件"):paused ? "已暂停":status
  menuTrackingInfo?.toolTip=listening ? (activity ? "记录文件活动，并辅助回忆投入时长":"仅记录文件活动"):status
  menuTrackingInfo?.update(title:title,detail:detail,symbol:listening ? "record.circle":paused ? "pause.circle":"exclamationmark.circle",color:listening ? journalMenuGreen:paused ? .secondaryLabelColor:.systemOrange)
  trackingToggleItem?.image=journalMenuSymbol(enabled ? "pause.circle":"play.circle");trackingToggleItem?.title=enabled ? "暂停自动记录":"继续自动记录";trackingToggleItem?.isEnabled = enabled || activity || status != "待绑定资料夹";trackingToggleItem?.state = .off
  menuTrackingInfo?.toggleSymbol=enabled ? "pause":"play";menuTrackingInfo?.control.toolTip=(enabled ? "暂停自动记录":"继续自动记录")+(listening ? (activity ? " · 文件与时长":" · 仅文件"):"");menuTrackingInfo?.control.setAccessibilityLabel(enabled ? "暂停自动记录":"继续自动记录");menuTrackingInfo?.control.isEnabled=trackingToggleItem?.isEnabled ?? false;menuTrackingInfo?.isEmphasized=listening;menuTrackingInfo?.control.contentTintColor=listening ? journalMenuGreen:journalMenuMuted;menuTrackingInfo?.needsDisplay=true
 }

 func menuWillOpen(_ menu:NSMenu){observer?.reload();refreshDaySummary()}

 @objc func openTodayDeadlines(){statusItem?.menu?.cancelTracking();pendingTodayDeadlines=true;showJournal(source:"todayDeadlines");routeTodayDeadlinesIfReady()}
 func routeTodayDeadlinesIfReady(){guard pendingTodayDeadlines,let view=webView else{return};view.evaluateJavaScript("(()=>{if(!window.journalViewReady||!window.journalOpenTodayDeadlines)return false;void window.journalOpenTodayDeadlines();return true})()") {[weak self] result,error in if error==nil,result as? Bool == true{self?.pendingTodayDeadlines=false}}}
 @objc func openJournal(){showJournal(source:"statusBar")}
 func showJournal(source:String){
  let existing=window != nil
  let timing=JournalStartupTiming(source:source,windowMode:existing ? "existingWindow":"newWindow");openingTiming=timing
  NSApp.setActivationPolicy(.regular);if !existing{createWindow()}
  if window.isMiniaturized{window.deminiaturize(nil)}
  window.collectionBehavior.remove(.canJoinAllSpaces)
  window.collectionBehavior.remove(.primary)
  window.collectionBehavior.remove(.auxiliary)
  window.collectionBehavior.remove(.fullScreenPrimary)
  window.collectionBehavior.insert([.moveToActiveSpace,.fullScreenAuxiliary,.canJoinAllApplications])
  NSApp.activate(ignoringOtherApps:true);window.makeKeyAndOrderFront(nil);window.orderFrontRegardless()
  timing.mark("windowShown")
  if existing{
   webView.evaluateJavaScript("window.journalCheckDay?.()",completionHandler:nil)
   webView.evaluateJavaScript("""
   (()=>{const deadline=performance.now()+120000;const ready=()=>{
    if(window.journalViewReady){requestAnimationFrame(()=>requestAnimationFrame(()=>window.webkit.messageHandlers.journalNative.postMessage({action:'openReady',measurementID:'\(timing.launchID)',page:document.querySelector('main>section:not([hidden])')?.id||''})));return}
    if(performance.now()<deadline)requestAnimationFrame(ready);
   };requestAnimationFrame(ready)})();
   """,completionHandler:nil)
  }
 }
 func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows flag:Bool)->Bool{showJournal(source:"dock");return true}
 @objc func toggleTracking(){guard let observer=observer else{return};var request=URLRequest(url:observer.server.appendingPathComponent("api/auto/status"));request.setValue(observer.token,forHTTPHeaderField:"X-Journal-Token");URLSession.shared.dataTask(with:request){data,_,_ in guard let data=data,let root=(try? JSONSerialization.jsonObject(with:data))as?[String:Any],var config=root["config"]as?[String:Any]else{return};config["enabled"] = !(config["enabled"]as?Bool ?? false);var update=URLRequest(url:observer.server.appendingPathComponent("api/auto/config"));update.httpMethod="PUT";update.setValue(observer.token,forHTTPHeaderField:"X-Journal-Token");update.setValue("application/json",forHTTPHeaderField:"Content-Type");update.httpBody=try? JSONSerialization.data(withJSONObject:["config":config,"revision":root["configRevision"] ?? ""]);URLSession.shared.dataTask(with:update){_,_,_ in DispatchQueue.main.async{observer.reload()}}.resume()}.resume()}
 func flushWindow(_ completion:@escaping(Bool)->Void){guard let view=webView else{completion(true);return};view.callAsyncJavaScript("return window.journalFlush ? await window.journalFlush() : true;",arguments:[:],in:nil,in:.page){result in if case .success(let value)=result{completion(value as?Bool == true)}else{completion(false)}}}
 func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage){guard let body=message.body as?[String:Any],let action=body["action"]as?String else{return};let id=body["id"]as?String ?? "";func reply(_ result:[String:Any]){self.webView?.callAsyncJavaScript("window.journalNativeReply && window.journalNativeReply(id,result)",arguments:["id":id,"result":result],in:nil,in:.page,completionHandler:nil)}
  if action=="startupReady",message.webView === webView{
   routeTodayDeadlinesIfReady()
   let timing=openingTiming ?? startupTiming
   let complete:()->Void={timing?.mark("pageReady",page:body["page"] as? String,pageMS:body["pageMs"] as? Double)}
   if let surface=launchSurface{launchSurface=nil;surface.finish(complete)}else{complete()}
   if openingTiming?.windowMode == "newWindow"{openingTiming=nil}
   navigatePendingReminder()
  }
  else if action=="openReady",message.webView === webView,let timing=openingTiming,body["measurementID"] as? String == timing.launchID{
   timing.mark("pageReady",page:body["page"] as? String);openingTiming=nil;navigatePendingReminder()
  }
  else if action=="appearance",message.webView === webView {
   if let solid=body["solid"] as? String,solid.range(of:"^#[0-9a-fA-F]{6}$",options:.regularExpression) != nil{UserDefaults.standard.set(solid,forKey:"JournalAccentSolid")}
   guard let scheme=body["scheme"] as? String,["system","light","dark"].contains(scheme),let accent=body["accent"] as? String,["fern","slate","iris","clay","sand","rose","macaron","custom"].contains(accent) else{return}
   if let hue=body["hue"] as? Double,hue.isFinite{UserDefaults.standard.set(min(359,max(0,hue.rounded())),forKey:"JournalCustomHue")}
   UserDefaults.standard.set(scheme,forKey:"JournalColorScheme");UserDefaults.standard.set(accent,forKey:"JournalAccent");journalApplyNativeAppearance()
   menuTrackingInfo?.needsDisplay=true;menuReminderInfo?.needsDisplay=true;menuSummary?.needsDisplay=true;menuDeadlineInfo?.needsDisplay=true
   // Refresh the cached title only; changing appearance must not rescan suggestions.
   if let count=reminderItem?.representedObject as? Int,count>0{reminderItem?.attributedTitle=journalPendingMenuTitle(count)}
  }
  else if action=="headerRegions" {
   if let rects=body["rects"] as? [[String:Double]] {headerControlRects=rects.compactMap{r in guard let x=r["x"],let y=r["y"],let w=r["width"],let h=r["height"],w>0,h>0 else{return nil};return NSRect(x:x,y:y,width:w,height:h)};alignTitlebar()}
  }
  else if action=="folders"{let panel=NSOpenPanel();panel.canChooseFiles=false;panel.canChooseDirectories=true;panel.allowsMultipleSelection = !(body["single"]as?Bool ?? false);panel.prompt=body["prompt"]as?String ?? "绑定资料夹";if let path=body["initial"]as?String,!path.isEmpty{panel.directoryURL=URL(fileURLWithPath:path)};panel.beginSheetModal(for:window){response in reply(["paths":response == .OK ? panel.urls.map{$0.path}:[]])}}
  else if action=="refreshDaySummary"{refreshDaySummary();schedulePendingSuggestions()}
  else if action=="refreshAuto"{schedulePendingSuggestions();if let observer=observer{observer.reload{reply(["ok":observer.networkError.isEmpty,"error":observer.networkError])}}else{reply(["ok":false,"error":"原生监听尚未就绪，请重新打开软件"])}}
  else if action=="loadClientView"{reply(["ok":true,"hiddenClients":UserDefaults.standard.stringArray(forKey:"JournalHiddenClients") ?? []])}
  else if action=="saveClientView"{
   guard let hidden=body["hiddenClients"] as? [String],hidden.count<=128,hidden.allSatisfy({$0.count<=256}) else{reply(["ok":false,"error":"客户端选择无效，请重新选择"]);return}
   UserDefaults.standard.set(hidden,forKey:"JournalHiddenClients");reply(["ok":true])
  }
  else if action=="titlePermission"{observer?.requestTitlePermission();reply(["ok":true])}
 }
 @objc func undoJournal(){stepJournal(-1)}
 @objc func redoJournal(){stepJournal(1)}
 func stepJournal(_ direction:Int){webView?.evaluateJavaScript("!!document.activeElement?.matches('input,textarea,[contenteditable=true]')"){ [weak self] result,_ in guard let self=self else{return};if result as? Bool == true{if direction<0{self.webView.undoManager?.undo()}else{self.webView.undoManager?.redo()}}else{self.webView.evaluateJavaScript("window.journalStepHistory && window.journalStepHistory(\(direction))",completionHandler:nil)}}}
 func alignTitlebar(){
  guard let frameView=window.contentView?.superview else{return}
  if titleDragArea == nil {let area=JournalWindowDragView(frame:.zero);area.setAccessibilityElement(false);titleDragArea=area}
  guard let dragArea=titleDragArea else{return}
  // Keep the transparent hit-test layer above AppKit's titlebar container.
  frameView.addSubview(dragArea,positioned:.above,relativeTo:nil)
  dragArea.frame=NSRect(x:0,y:frameView.bounds.maxY-58,width:frameView.bounds.width,height:58)
  // Treat the controls and title as one group: a shared title-row center
  // with the web navigation and actions.
  let controlHalfHeight=(window.standardWindowButton(.closeButton)?.frame.height ?? 14)/2
  let anchor=NSPoint(x:20,y:frameView.bounds.maxY-25-controlHalfHeight)
  for type in [NSWindow.ButtonType.closeButton,.miniaturizeButton,.zoomButton]{
   if let button=window.standardWindowButton(type),let parent=button.superview {
    let point=parent.convert(anchor,from:frameView),offset:CGFloat=type == .closeButton ? 0 : type == .miniaturizeButton ? 23 : 46
    var frame=button.frame;frame.origin=NSPoint(x:point.x+offset,y:point.y-frame.height/2);button.frame=frame
   }
  }
  // Preserve native controls/title and the measured HTML navigation/actions.
  dragArea.excludedAreas=[NSRect(x:0,y:0,width:188,height:58)]
  if headerControlRects.isEmpty {dragArea.excludedAreas += [NSRect(x:188,y:0,width:155,height:58),NSRect(x:max(188,dragArea.bounds.width-260),y:0,width:260,height:58)]}
  for rect in headerControlRects {
   let originY=webView.isFlipped ? rect.minY : webView.bounds.maxY-rect.maxY
   let webRect=NSRect(x:rect.minX,y:originY,width:rect.width,height:rect.height)
   dragArea.excludedAreas.append(dragArea.convert(webRect,from:webView).insetBy(dx:-3,dy:-3))
  }
  guard let close=window.standardWindowButton(.closeButton),let view=window.titlebarAccessoryViewControllers.first?.view else{return}
  let center=view.convert(close.bounds,from:close).midY
  for item in view.subviews {var frame=item.frame;frame.origin.y=center-frame.height/2;item.frame=frame;item.needsDisplay=true}
 }
 func windowDidBecomeKey(_ notification:Notification){alignTitlebar();webView?.evaluateJavaScript("window.journalCheckDay?.()",completionHandler:nil)}

 func windowDidResize(_ notification:Notification){alignTitlebar()}
 func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!){alignTitlebar();webView.evaluateJavaScript("window.journalSyncHeaderDragRegions && window.journalSyncHeaderDragRegions()",completionHandler:nil)}
 func handleOutput(_ text:String){outputBuffer+=text;guard !loaded else{return};for line in outputBuffer.components(separatedBy:.newlines){if line.hasPrefix("http://127.0.0.1:"),line.contains("?token="),let url=URL(string:line){loaded=true;startupTiming?.mark("backendReady");launchURL=url;startupTimer?.invalidate();webView?.load(URLRequest(url:url));if var components=URLComponents(url:url,resolvingAgainstBaseURL:false),let token=components.queryItems?.first(where:{$0.name=="token"})?.value{components.query=nil;components.path="/";if let base=components.url{observer=JournalObserver(server:base,token:token);observer?.onStatus={ [weak self] state in self?.updateTrackingMenu(state) };refreshDaySummary();schedulePendingSuggestions();observer?.reload{ [weak self] in guard let self=self,self.backgroundLaunch,self.observer?.networkError.isEmpty==true else{return};self.startupTiming?.mark("monitorReady") }}};return}}}
 func showError(_ text:String){startupTimer?.invalidate();let alert=NSAlert();alert.messageText="项目手记暂时无法启动";alert.informativeText=String(text.prefix(1600));alert.runModal();terminating=true;if task?.isRunning==true{task?.terminate()};NSApp.terminate(nil)}
 func windowShouldClose(_ sender:NSWindow)->Bool{flushWindow{[weak self] ok in guard let self=self,ok else{return};self.webView?.configuration.userContentController.removeScriptMessageHandler(forName:"journalNative");self.webView?.navigationDelegate=nil;self.webView?.uiDelegate=nil;self.window?.delegate=nil;self.window?.contentView=nil;self.window?.close();self.window=nil;self.webView=nil;self.launchSurface=nil;self.titleDragArea=nil;self.headerControlRects=[];NSApp.setActivationPolicy(.accessory)};return false}
 func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool{return false}
 func applicationShouldTerminate(_ sender:NSApplication)->NSApplication.TerminateReply{if terminating || !loaded{return .terminateNow};flushWindow{[weak self] ok in guard let self=self else{return};if !ok{let alert=NSAlert();alert.messageText="自动保存尚未完成";alert.informativeText="内容仍保留在窗口中。请检查填写内容或同步提示，再退出。";alert.runModal();NSApp.reply(toApplicationShouldTerminate:false);return};self.terminating=true;if let observer=self.observer{observer.flush{NSApp.reply(toApplicationShouldTerminate:true)}}else{NSApp.reply(toApplicationShouldTerminate:true)}};return .terminateLater}

 func applicationWillTerminate(_ notification:Notification){dailySummaryTimer?.invalidate();pendingCheckTimer?.invalidate();pendingRefreshTask?.cancel();terminating=true;startupTimer?.invalidate();if task?.isRunning==true{task?.terminate()}}
 func webViewDidClose(_ webView:WKWebView){NSApp.terminate(nil)}
 func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){guard let url=navigationAction.request.url else{decisionHandler(.cancel);return};if navigationAction.shouldPerformDownload{decisionHandler(.download);return};if url.host=="127.0.0.1"||url.scheme=="about"||url.scheme=="blob"{decisionHandler(.allow)}else{decisionHandler(.cancel)}}
 func webView(_ webView:WKWebView,navigationAction:WKNavigationAction,didBecome download:WKDownload){download.delegate=self}
 func webView(_ webView:WKWebView,runOpenPanelWith parameters:WKOpenPanelParameters,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping([URL]?)->Void){let panel=NSOpenPanel();panel.canChooseDirectories=false;panel.allowsMultipleSelection=false;panel.allowedContentTypes=[.json];panel.beginSheetModal(for:window){ response in completionHandler(response == .OK ? panel.urls:nil)}}
 func download(_ download:WKDownload,decideDestinationUsing response:URLResponse,suggestedFilename:String,completionHandler:@escaping(URL?)->Void){let panel=NSSavePanel();panel.nameFieldStringValue=suggestedFilename;panel.allowedContentTypes=[.json];panel.beginSheetModal(for:window){ reply in completionHandler(reply == .OK ? panel.url:nil)}}
}
@main struct JournalMain { static func main(){
if CommandLine.arguments.count>3 && CommandLine.arguments[1]=="--observer-test" {
 let observer=JournalObserver(server:URL(string:"http://127.0.0.1:1")!,token:"");observer.eventSink={body in if let data=try? JSONSerialization.data(withJSONObject:body,options:.sortedKeys),let text=String(data:data,encoding:.utf8){print(text);fflush(stdout)}}
 observer.configure(["enabled":true,"activity":false,"bindings":[["path":CommandLine.arguments[2]]]])
 let duration=Double(CommandLine.arguments[3]) ?? 60
 let timer=Timer.scheduledTimer(withTimeInterval:duration,repeats:false){_ in observer.flush{print("OBSERVER_TEST_DONE");fflush(stdout);exit(0)}}
 withExtendedLifetime(timer){RunLoop.main.run()};return
}
let backgroundLaunch=CommandLine.arguments.contains("--background")
let startupTiming=JournalStartupTiming(source:backgroundLaunch ? "backgroundStart":"coldStart")
let app=NSApplication.shared
let delegate=JournalApp()
delegate.startupTiming=startupTiming
app.delegate=delegate
app.setActivationPolicy(backgroundLaunch ? .accessory:.regular)
app.run()
}}
