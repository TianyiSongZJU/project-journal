import Cocoa
import WebKit
import UniformTypeIdentifiers
import CoreText

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
  let text=NSAttributedString(string:"项目手记",attributes:[.font:font,.foregroundColor:NSColor(calibratedRed:0.19,green:0.24,blue:0.20,alpha:1)])
  let line=CTLineCreateWithAttributedString(text)
  context.saveGState();context.textMatrix = .identity
  let ink=CTLineGetImageBounds(line,context)
  context.textPosition=CGPoint(x:-ink.minX,y:bounds.midY-ink.midY)
  CTLineDraw(line,context);context.restoreGState()
 }
}

final class JournalApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler, NSMenuDelegate {
 var window: NSWindow!
 var titleDragArea:JournalWindowDragView?
 var headerControlRects:[NSRect]=[]
 var webView: WKWebView!
 var task: Process?
 var launchURL:URL?
 var observer:JournalObserver?
 var statusItem:NSStatusItem?
 var trackingStatusItem:NSMenuItem?
 var trackingToggleItem:NSMenuItem?
 var loaded = false
 var terminating = false
 var outputBuffer = ""
 var startupTimer: Timer?
 func applicationDidFinishLaunching(_ notification: Notification) {
  let menu = NSMenu(); let appItem = NSMenuItem(); menu.addItem(appItem)
  let appMenu = NSMenu();appMenu.addItem(withTitle:"关于项目手记", action:#selector(NSApplication.orderFrontStandardAboutPanel(_:)),keyEquivalent:"");appMenu.addItem(.separator());appMenu.addItem(withTitle:"隐藏项目手记",action:#selector(NSApplication.hide(_:)),keyEquivalent:"h");appMenu.addItem(withTitle:"退出项目手记",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q");appItem.submenu=appMenu
  let editItem=NSMenuItem();menu.addItem(editItem);let edit=NSMenu(title:"编辑");edit.addItem(withTitle:"撤销",action:#selector(undoJournal),keyEquivalent:"z");let redoItem=edit.addItem(withTitle:"重做",action:#selector(redoJournal),keyEquivalent:"z");redoItem.keyEquivalentModifierMask=[.command,.shift];edit.addItem(.separator());for (title,selector,key) in [("剪切","cut:","x"),("复制","copy:","c"),("粘贴","paste:","v"),("全选","selectAll:","a")]{edit.addItem(withTitle:title,action:NSSelectorFromString(selector),keyEquivalent:key)};editItem.submenu=edit;let windowItem=NSMenuItem();menu.addItem(windowItem);let windowMenu=NSMenu(title:"窗口");windowMenu.addItem(withTitle:"关闭窗口",action:#selector(NSWindow.performClose(_:)),keyEquivalent:"w");windowMenu.addItem(withTitle:"最小化",action:#selector(NSWindow.performMiniaturize(_:)),keyEquivalent:"m");windowItem.submenu=windowMenu;NSApp.windowsMenu=windowMenu;NSApp.mainMenu=menu
  if let iconURL=Bundle.main.url(forResource:"AppIcon",withExtension:"icns"){NSApp.applicationIconImage=NSImage(contentsOf:iconURL)}
  installStatusItem();createWindow()
  let bundle=Bundle.main.bundleURL;let base=bundle.deletingLastPathComponent();let nested=base.appendingPathComponent("项目手记/数据");let english=base.appendingPathComponent("data");let legacy=FileManager.default.fileExists(atPath:nested.path) ? nested : base.appendingPathComponent("数据");let data=FileManager.default.fileExists(atPath:english.path) || !FileManager.default.fileExists(atPath:legacy.path) ? english : legacy;let backend=Bundle.main.resourceURL!.appendingPathComponent("journal-core")
  let process=Process();process.executableURL=backend;process.arguments=["--no-open","--window-url","--data-dir",data.path,"--parent-pid",String(ProcessInfo.processInfo.processIdentifier)];if let home=Bundle.main.object(forInfoDictionaryKey:"JournalAutomationHome")as?String{process.arguments! += ["--auto-home",home]}else{let local=base.appendingPathComponent("local/macos");if FileManager.default.fileExists(atPath:local.path){process.arguments! += ["--auto-home",local.path]}};let output=Pipe();process.standardOutput=output;process.standardError=output;task=process
  output.fileHandleForReading.readabilityHandler={ [weak self] handle in let bytes=handle.availableData;if bytes.isEmpty{return};let str=String(data:bytes,encoding:.utf8) ?? "";DispatchQueue.main.async { self?.handleOutput(str) } }
  process.terminationHandler={ [weak self] _ in DispatchQueue.main.async { guard let self=self, !self.terminating else{return};if !self.loaded { self.showError(self.outputBuffer.isEmpty ? "本地程序未能启动。请检查软件文件是否完整。" : self.outputBuffer) } else { NSApp.terminate(nil) } } }
  do{try process.run()}catch{showError("无法启动本地程序：\(error.localizedDescription)")}
  startupTimer=Timer.scheduledTimer(withTimeInterval:20,repeats:false){ [weak self] _ in guard let self=self,!self.loaded else{return};self.showError("启动超时，请检查文件夹权限。\n\(self.outputBuffer)") }
 }
 func createWindow(){
  let config=WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent()
  config.userContentController.addUserScript(WKUserScript(source:"document.documentElement.classList.add('native-mac')",injectionTime:.atDocumentEnd,forMainFrameOnly:true))
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
  window=NSWindow(contentRect:NSRect(x:0,y:0,width:1120,height:720),styleMask:[.titled,.closable,.miniaturizable,.resizable,.fullSizeContentView],backing:.buffered,defer:false);window.isReleasedWhenClosed=false;window.title="项目手记";window.titleVisibility = .hidden;window.titlebarAppearsTransparent = true;window.backgroundColor=NSColor(calibratedRed:0.933333,green:0.929412,blue:0.913725,alpha:1);window.minSize=NSSize(width:740,height:560);window.isMovable=true;window.isMovableByWindowBackground=true;window.delegate=self;window.contentView=webView;
  let titleAccessory=NSTitlebarAccessoryViewController();titleAccessory.layoutAttribute = .left
  window.titlebarAppearsTransparent = true
  let titleView=JournalTitleContainer(frame:NSRect(x:0,y:0,width:165,height:38))
  let titleLabel=JournalTitleText(frame:NSRect(x:24,y:9,width:80,height:24));titleLabel.setAccessibilityElement(true);titleLabel.setAccessibilityRole(.staticText);titleLabel.setAccessibilityLabel("项目手记");titleView.addSubview(titleLabel)
  titleAccessory.view=titleView;window.addTitlebarAccessoryViewController(titleAccessory)
  window.center();window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true);DispatchQueue.main.async { [weak self] in self?.alignTitlebar() }
  webView.loadHTMLString("<html><body style='background:#f6f3eb;color:#315c46;font:20px serif;padding:80px'>项目手记<br><small>正在打开本地记录…</small></body></html>",baseURL:nil)
  if let url=launchURL{webView.load(URLRequest(url:url))}
 }
 func installStatusItem(){statusItem=NSStatusBar.system.statusItem(withLength:NSStatusItem.squareLength);statusItem?.button?.image=NSImage(systemSymbolName:"square.grid.3x3.fill",accessibilityDescription:"项目手记");let menu=NSMenu();menu.delegate=self;let state=NSMenuItem(title:"正在读取记录状态…",action:nil,keyEquivalent:"");state.isEnabled=false;menu.addItem(state);trackingStatusItem=state;menu.addItem(.separator());menu.addItem(withTitle:"打开项目手记",action:#selector(openJournal),keyEquivalent:"");let toggle=menu.addItem(withTitle:"继续自动记录",action:#selector(toggleTracking),keyEquivalent:"");toggle.isEnabled=false;trackingToggleItem=toggle;menu.addItem(.separator());menu.addItem(withTitle:"退出项目手记",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"");statusItem?.menu=menu}
 func updateTrackingMenu(_ state:[String:Any]){let enabled=state["enabled"]as?Bool ?? false;let activity=state["activityEnabled"]as?Bool ?? false;let status=state["status"]as?String ?? "正在读取";let label=status=="监听中" ? "监听中 · \(activity ? "文件＋时长辅助":"仅文件活动")":status;trackingStatusItem?.title="● "+label;statusItem?.button?.toolTip="项目手记 · "+label;trackingToggleItem?.title=enabled ? "暂停自动记录":"继续自动记录";trackingToggleItem?.isEnabled = status != "待绑定资料夹";trackingToggleItem?.state = .off}
 func menuWillOpen(_ menu:NSMenu){observer?.reload()}

 @objc func openJournal(){NSApp.setActivationPolicy(.regular);if window==nil{createWindow()};window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)}
 func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows flag:Bool)->Bool{openJournal();return true}
 @objc func toggleTracking(){guard let observer=observer else{return};var request=URLRequest(url:observer.server.appendingPathComponent("api/auto/status"));request.setValue(observer.token,forHTTPHeaderField:"X-Journal-Token");URLSession.shared.dataTask(with:request){data,_,_ in guard let data=data,let root=(try? JSONSerialization.jsonObject(with:data))as?[String:Any],var config=root["config"]as?[String:Any]else{return};config["enabled"] = !(config["enabled"]as?Bool ?? false);var update=URLRequest(url:observer.server.appendingPathComponent("api/auto/config"));update.httpMethod="PUT";update.setValue(observer.token,forHTTPHeaderField:"X-Journal-Token");update.setValue("application/json",forHTTPHeaderField:"Content-Type");update.httpBody=try? JSONSerialization.data(withJSONObject:["config":config,"revision":root["configRevision"] ?? ""]);URLSession.shared.dataTask(with:update){_,_,_ in DispatchQueue.main.async{observer.reload()}}.resume()}.resume()}
 func flushWindow(_ completion:@escaping(Bool)->Void){guard let view=webView else{completion(true);return};view.callAsyncJavaScript("return window.journalFlush ? await window.journalFlush() : true;",arguments:[:],in:nil,in:.page){result in if case .success(let value)=result{completion(value as?Bool == true)}else{completion(false)}}}
 func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage){guard let body=message.body as?[String:Any],let action=body["action"]as?String else{return};let id=body["id"]as?String ?? "";func reply(_ result:[String:Any]){self.webView?.callAsyncJavaScript("window.journalNativeReply && window.journalNativeReply(id,result)",arguments:["id":id,"result":result],in:nil,in:.page,completionHandler:nil)}
  if action=="headerRegions" {
   if let rects=body["rects"] as? [[String:Double]] {headerControlRects=rects.compactMap{r in guard let x=r["x"],let y=r["y"],let w=r["width"],let h=r["height"],w>0,h>0 else{return nil};return NSRect(x:x,y:y,width:w,height:h)};alignTitlebar()}
  }
  else if action=="folders"{let panel=NSOpenPanel();panel.canChooseFiles=false;panel.canChooseDirectories=true;panel.allowsMultipleSelection = !(body["single"]as?Bool ?? false);panel.prompt=body["prompt"]as?String ?? "绑定资料夹";if let path=body["initial"]as?String,!path.isEmpty{panel.directoryURL=URL(fileURLWithPath:path)};panel.beginSheetModal(for:window){response in reply(["paths":response == .OK ? panel.urls.map{$0.path}:[]])}}
  else if action=="refreshAuto"{if let observer=observer{observer.reload{reply(["ok":observer.networkError.isEmpty,"error":observer.networkError])}}else{reply(["ok":false,"error":"原生监听尚未就绪，请重新打开软件"])}}
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
 func windowDidBecomeKey(_ notification:Notification){alignTitlebar()}

 func windowDidResize(_ notification:Notification){alignTitlebar()}
 func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!){alignTitlebar();webView.evaluateJavaScript("window.journalSyncHeaderDragRegions && window.journalSyncHeaderDragRegions()",completionHandler:nil)}
 func handleOutput(_ text:String){outputBuffer+=text;guard !loaded else{return};for line in outputBuffer.components(separatedBy:.newlines){if line.hasPrefix("http://127.0.0.1:"),line.contains("?token="),let url=URL(string:line){loaded=true;launchURL=url;startupTimer?.invalidate();webView?.load(URLRequest(url:url));if var components=URLComponents(url:url,resolvingAgainstBaseURL:false),let token=components.queryItems?.first(where:{$0.name=="token"})?.value{components.query=nil;components.path="/";if let base=components.url{observer=JournalObserver(server:base,token:token);observer?.onStatus={ [weak self] state in self?.updateTrackingMenu(state) };observer?.reload()}};return}}}
 func showError(_ text:String){startupTimer?.invalidate();let alert=NSAlert();alert.messageText="项目手记暂时无法启动";alert.informativeText=String(text.prefix(1600));alert.runModal();terminating=true;if task?.isRunning==true{task?.terminate()};NSApp.terminate(nil)}
 func windowShouldClose(_ sender:NSWindow)->Bool{flushWindow{[weak self] ok in guard let self=self,ok else{return};self.webView?.configuration.userContentController.removeScriptMessageHandler(forName:"journalNative");self.webView?.navigationDelegate=nil;self.webView?.uiDelegate=nil;self.window?.delegate=nil;self.window?.contentView=nil;self.window?.close();self.window=nil;self.webView=nil;NSApp.setActivationPolicy(.accessory)};return false}
 func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool{return false}
 func applicationShouldTerminate(_ sender:NSApplication)->NSApplication.TerminateReply{if terminating || !loaded{return .terminateNow};flushWindow{[weak self] ok in guard let self=self else{return};if !ok{let alert=NSAlert();alert.messageText="自动保存尚未完成";alert.informativeText="内容仍保留在窗口中。请检查填写内容或同步提示，再退出。";alert.runModal();NSApp.reply(toApplicationShouldTerminate:false);return};self.terminating=true;if let observer=self.observer{observer.flush{NSApp.reply(toApplicationShouldTerminate:true)}}else{NSApp.reply(toApplicationShouldTerminate:true)}};return .terminateLater}

 func applicationWillTerminate(_ notification:Notification){terminating=true;startupTimer?.invalidate();if task?.isRunning==true{task?.terminate()}}
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
let app=NSApplication.shared
let delegate=JournalApp()
app.delegate=delegate
app.setActivationPolicy(.regular)
app.run()
}}
