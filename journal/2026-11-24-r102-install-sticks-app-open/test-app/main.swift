import UIKit
import AVFoundation
final class SD: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  func scene(_ s: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    guard let ws = s as? UIWindowScene else { return }
    window = UIWindow(windowScene: ws)
    let vc = UIViewController(); vc.view.backgroundColor = .systemGreen
    let l = UILabel(frame: vc.view.bounds); l.text = "R102Test\nsilent audio"; l.numberOfLines = 0; l.textAlignment = .center; l.font = .boldSystemFont(ofSize: 40)
    vc.view.addSubview(l); window?.rootViewController = vc; window?.makeKeyAndVisible()
  }
}
@main final class AD: UIResponder, UIApplicationDelegate {
  var engine = AVAudioEngine()
  var player = AVAudioPlayerNode()
  func application(_ a: UIApplication, didFinishLaunchingWithOptions o: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
    try? AVAudioSession.sharedInstance().setActive(true)
    let fmt = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
    let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: 44100)!; buf.frameLength = 44100
    engine.attach(player); engine.connect(player, to: engine.mainMixerNode, format: fmt)
    try? engine.start(); player.scheduleBuffer(buf, at: nil, options: .loops); player.play()
    NSLog("R102Test playing silent audio, running=%d", engine.isRunning ? 1 : 0)
    return true
  }
  func application(_ a: UIApplication, configurationForConnecting c: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
    let cfg = UISceneConfiguration(name: "Default", sessionRole: c.role); cfg.delegateClass = SD.self; return cfg
  }
}
