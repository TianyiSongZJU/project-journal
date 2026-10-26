// Combined with the titlebar views from macos.swift by titlebar-hit-test.sh.
let app=NSApplication.shared
let window=NSWindow(contentRect:NSRect(x:0,y:0,width:1120,height:720),styleMask:[.titled,.closable,.miniaturizable,.resizable,.fullSizeContentView],backing:.buffered,defer:false)
window.contentView=NSView(frame:NSRect(x:0,y:0,width:1120,height:720))
let frameView=window.contentView!.superview!
let area=JournalWindowDragView(frame:NSRect(x:0,y:frameView.bounds.maxY-58,width:frameView.bounds.width,height:58))
frameView.addSubview(area,positioned:.above,relativeTo:nil)
area.excludedAreas=[NSRect(x:0,y:0,width:188,height:58),NSRect(x:188,y:0,width:155,height:58)]
for (i,type) in [NSWindow.ButtonType.closeButton,.miniaturizeButton,.zoomButton].enumerated(){
 let button=window.standardWindowButton(type)!,parent=button.superview!
 let target=parent.convert(NSPoint(x:20+CGFloat(i)*23,y:frameView.bounds.maxY-32),from:frameView)
 button.setFrameOrigin(NSPoint(x:target.x,y:target.y-button.frame.height/2))
 let point=frameView.convert(NSPoint(x:button.bounds.midX,y:button.bounds.midY),from:button)
 precondition(area.hitTest(point) === button,"Native traffic-light click intercepted")
 precondition(frameView.hitTest(point) === button,"Full window hit testing lost native button")
}
let htmlPoint=frameView.convert(NSPoint(x:250,y:25),from:area)
precondition(area.hitTest(htmlPoint)==nil,"HTML navigation must remain clickable")
let blank=frameView.convert(NSPoint(x:500,y:25),from:area)
precondition(area.hitTest(blank) === area,"Empty titlebar must remain draggable")
print("PASS native close/minimize/zoom routing through full window, HTML exclusions and titlebar dragging")
