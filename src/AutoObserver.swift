import Cocoa
import CoreServices
import ApplicationServices

final class JournalObserver {
 let server:URL
 let token:String
 var onStatus:(([String:Any])->Void)?
 var networkError=""
 var reloadGeneration=0
 var lastConfig:Data?
 var lastStatus:[String:Any]=[:]
 var stream:FSEventStreamRef?
 var activityTimer:Timer?
 var workspaceTokens:[NSObjectProtocol]=[]
 var axObserver:AXObserver?
 var axWindow:AXUIElement?
 var pendingPosts=0
 var settled:[()->Void]=[]
 var enabled=false
 var activityEnabled=false
 var lastPaused=false
 var eventSink:(([String:Any])->Void)?
 init(server:URL,token:String){self.server=server;self.token=token}
 func post(_ body:[String:Any],path:String="/api/auto/events",completion:(()->Void)?=nil){
  if let sink=eventSink {sink(body);completion?();return}
  var request=URLRequest(url:server.appendingPathComponent(String(path.dropFirst())));request.httpMethod="POST";request.setValue(token,forHTTPHeaderField:"X-Journal-Token");request.setValue("application/json",forHTTPHeaderField:"Content-Type");request.httpBody=try? JSONSerialization.data(withJSONObject:body);request.timeoutInterval=10
  pendingPosts += 1;URLSession.shared.dataTask(with:request){[weak self] _,response,error in DispatchQueue.main.async{guard let self=self else{return};let code=(response as?HTTPURLResponse)?.statusCode ?? 0;if let error=error{self.networkError=error.localizedDescription}else if code != 200{self.networkError="记录服务响应异常（\(code)）"};self.pendingPosts -= 1;completion?();if self.pendingPosts==0{let callbacks=self.settled;self.settled=[];callbacks.forEach{$0()}}}}.resume()
 }
 func reload(completion:(()->Void)?=nil){
  reloadGeneration+=1;let generation=reloadGeneration
  var request=URLRequest(url:server.appendingPathComponent("api/auto/status"));request.setValue(token,forHTTPHeaderField:"X-Journal-Token");request.timeoutInterval=10
  URLSession.shared.dataTask(with:request){[weak self] data,response,error in
   guard let self=self else{return}
   let code=(response as?HTTPURLResponse)?.statusCode ?? 0
   guard error==nil,code==200,let data=data,let root=(try? JSONSerialization.jsonObject(with:data))as?[String:Any],let config=root["config"]as?[String:Any] else{DispatchQueue.main.async{self.networkError=error?.localizedDescription ?? "记录服务响应异常（\(code)）";self.onStatus?(["status":"记录服务连接异常","enabled":false,"watching":0]);completion?()};return}
   DispatchQueue.main.async{self.networkError="";if self.reloadGeneration==generation{self.configure(config)};if let completion=completion{if self.pendingPosts==0{completion()}else{self.settled.append(completion)}}}
  }.resume()
 }

 func configure(_ config:[String:Any]){
  let roots=(config["bindings"]as?[[String:Any]] ?? []).compactMap{$0["path"]as?String}
  let signature=(try? JSONSerialization.data(withJSONObject:["enabled":config["enabled"] ?? false,"activity":config["activity"] ?? false,"roots":roots,"trusted":AXIsProcessTrusted()],options:.sortedKeys));if signature==lastConfig{onStatus?(lastStatus);post(lastStatus);return};lastConfig=signature
  stop();enabled=config["enabled"]as?Bool ?? false;activityEnabled=config["activity"]as?Bool ?? false
  guard enabled else{let status:[String:Any]=["status":"已暂停","watching":0,"enabled":false,"activityEnabled":activityEnabled];lastStatus=status;onStatus?(status);post(status);return}
  var watchError="";if !roots.isEmpty {
   var context=FSEventStreamContext(version:0,info:Unmanaged.passUnretained(self).toOpaque(),retain:nil,release:nil,copyDescription:nil)
   let callback:FSEventStreamCallback={_,info,count,eventPaths,flags,_ in
    guard let info=info else{return};let owner=Unmanaged<JournalObserver>.fromOpaque(info).takeUnretainedValue();let paths=unsafeBitCast(eventPaths,to:NSArray.self);var changed=Set<String>()
    var reconcile=false;for i in 0..<count{let flag=flags[i];if flag & FSEventStreamEventFlags(kFSEventStreamEventFlagMustScanSubDirs|kFSEventStreamEventFlagUserDropped|kFSEventStreamEventFlagKernelDropped|kFSEventStreamEventFlagRootChanged) != 0 {reconcile=true};if flag & FSEventStreamEventFlags(kFSEventStreamEventFlagItemIsDir) != 0 {continue};if let path=paths[i]as?String{changed.insert(path)}}
    if reconcile{owner.post(["reconcile":true])};let list=Array(changed);if !list.isEmpty{for start in stride(from:0,to:list.count,by:1000){owner.post(["paths":Array(list[start..<min(start+1000,list.count)])])}}
   }
   stream=FSEventStreamCreate(nil,callback,&context,roots as CFArray,FSEventStreamEventId(kFSEventStreamEventIdSinceNow),15,FSEventStreamCreateFlags(kFSEventStreamCreateFlagUseCFTypes|kFSEventStreamCreateFlagFileEvents|kFSEventStreamCreateFlagWatchRoot))
   if let stream=stream{FSEventStreamSetDispatchQueue(stream,DispatchQueue.main);if !FSEventStreamStart(stream){watchError="文件监听未启动，请检查资料夹是否仍可访问"}}else{watchError="无法建立文件监听，请检查资料夹权限"}
  }
  let status:[String:Any]=["status":watchError.isEmpty ? (roots.isEmpty ? "待绑定资料夹":"监听中"):"监听异常","error":watchError,"watching":watchError.isEmpty ? roots.count:0,"enabled":enabled,"activityEnabled":activityEnabled];lastStatus=status;onStatus?(status);post(status)
  if activityEnabled {
   let ws=NSWorkspace.shared.notificationCenter
   workspaceTokens.append(ws.addObserver(forName:NSWorkspace.didActivateApplicationNotification,object:nil,queue:.main){[weak self]_ in self?.watchCurrentApp();self?.capture()})
   for name in [NSWorkspace.willSleepNotification,NSWorkspace.screensDidSleepNotification,NSWorkspace.sessionDidResignActiveNotification]{workspaceTokens.append(ws.addObserver(forName:name,object:nil,queue:.main){[weak self]_ in self?.capture(paused:true)})}
   for name in [NSWorkspace.didWakeNotification,NSWorkspace.screensDidWakeNotification,NSWorkspace.sessionDidBecomeActiveNotification]{workspaceTokens.append(ws.addObserver(forName:name,object:nil,queue:.main){[weak self]_ in self?.post(["reconcile":true]);self?.capture(paused:true);self?.capture()})}
   watchCurrentApp();capture()
   let timer=Timer(timeInterval:60,repeats:true){[weak self]_ in self?.capture()};timer.tolerance=15;activityTimer=timer;RunLoop.main.add(timer,forMode:.common)
  }
 }
 func stop(){if let stream=stream{FSEventStreamStop(stream);FSEventStreamInvalidate(stream);FSEventStreamRelease(stream)};stream=nil;activityTimer?.invalidate();activityTimer=nil;for token in workspaceTokens{NSWorkspace.shared.notificationCenter.removeObserver(token)};workspaceTokens=[];removeAX()}
 func removeAX(){if let observer=axObserver{CFRunLoopRemoveSource(CFRunLoopGetMain(),AXObserverGetRunLoopSource(observer),.defaultMode)};axObserver=nil;axWindow=nil}
 func attribute(_ element:AXUIElement,_ key:CFString)->AnyObject?{var value:CFTypeRef?;guard AXUIElementCopyAttributeValue(element,key,&value) == .success else{return nil};return value}
 func currentWindow()->AXUIElement?{guard let app=NSWorkspace.shared.frontmostApplication else{return nil};let element=AXUIElementCreateApplication(app.processIdentifier);guard let value=attribute(element,kAXFocusedWindowAttribute as CFString) else{return nil};if CFGetTypeID(value)==AXUIElementGetTypeID(){return unsafeBitCast(value,to:AXUIElement.self)};return nil}
 func watchCurrentApp(){removeAX();guard AXIsProcessTrusted(),let app=NSWorkspace.shared.frontmostApplication else{return};var observer:AXObserver?;let callback:AXObserverCallback={_,_,notification,info in guard let info=info else{return};let owner=Unmanaged<JournalObserver>.fromOpaque(info).takeUnretainedValue();if notification as String == kAXFocusedWindowChangedNotification as String{owner.attachWindow()};owner.capture()};guard AXObserverCreate(app.processIdentifier,callback,&observer) == .success,let observer=observer else{return};axObserver=observer;let ref=Unmanaged.passUnretained(self).toOpaque();let appElement=AXUIElementCreateApplication(app.processIdentifier);AXObserverAddNotification(observer,appElement,kAXFocusedWindowChangedNotification as CFString,ref);attachWindow();CFRunLoopAddSource(CFRunLoopGetMain(),AXObserverGetRunLoopSource(observer),.defaultMode)}
 func attachWindow(){guard let observer=axObserver else{return};if let old=axWindow{AXObserverRemoveNotification(observer,old,kAXTitleChangedNotification as CFString)};if let window=currentWindow(){axWindow=window;AXObserverAddNotification(observer,window,kAXTitleChangedNotification as CFString,Unmanaged.passUnretained(self).toOpaque())}}
 func capture(paused:Bool=false,completion:(()->Void)?=nil){guard enabled&&activityEnabled else{completion?();return};let app=NSWorkspace.shared.frontmostApplication;var title="",document="";let trusted=AXIsProcessTrusted();if trusted,let window=currentWindow(){title=attribute(window,kAXTitleAttribute as CFString)as?String ?? "";if let raw=attribute(window,kAXDocumentAttribute as CFString)as?String{if let url=URL(string:raw),url.isFileURL{document=url.path}}};let eventType=CGEventType(rawValue:UInt32.max)!;let idle=CGEventSource.secondsSinceLastEventType(.combinedSessionState,eventType:eventType);let name=app?.localizedName ?? "";let inactive=paused || app?.bundleIdentifier=="com.apple.loginwindow";let formatter=ISO8601DateFormatter();formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds];post(["activity":["at":formatter.string(from:Date()),"app":name,"title":String(title.prefix(1000)),"document":document,"idleSeconds":idle.isFinite ? idle:0,"paused":inactive,"titleAccess":trusted]],completion:completion)}
 func flush(completion:@escaping()->Void){activityTimer?.invalidate();activityTimer=nil;let finish={ [weak self] in guard let self=self else{completion();return};self.capture{self.stop();let flush={self.post([:],path:"/api/auto/flush",completion:completion)};if self.pendingPosts==0{flush()}else{self.settled.append(flush)}}};if let stream=stream{FSEventStreamRetain(stream);DispatchQueue.global(qos:.utility).async{FSEventStreamFlushSync(stream);FSEventStreamRelease(stream);DispatchQueue.main.async(execute:finish)}}else{finish()}}
 func requestTitlePermission(){let options=[kAXTrustedCheckOptionPrompt.takeUnretainedValue()as String:true]as CFDictionary;_ = AXIsProcessTrustedWithOptions(options);if let url=URL(string:"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"){NSWorkspace.shared.open(url)}}
 deinit{stop()}
}
